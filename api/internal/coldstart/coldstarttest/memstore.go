// Package coldstarttest 提供 coldstart.Store、coldstart.Objects、coldstart.Preprocessor 的記憶體實作，
// 供單元測試與 HTTP 測試使用。
package coldstarttest

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sync"
	"time"

	"github.com/your-org/diet-app/api/internal/coldstart"
)

type nutritionRow struct {
	productID   string
	basis       coldstart.Basis
	values      coldstart.Nutrients
	confirmedBy string
	confirmedAt time.Time
	superseded  bool
}

type imageRow struct {
	submissionID string
	productID    string
	img          coldstart.Image
}

type state struct {
	submissions map[string]coldstart.Submission
	products    map[string]coldstart.Product // 不含 Nutrition、Images（讀取時組合）
	nutrition   []nutritionRow
	images      []imageRow
}

func (s state) clone() state {
	return state{
		submissions: maps.Clone(s.submissions),
		products:    maps.Clone(s.products),
		nutrition:   slices.Clone(s.nutrition),
		images:      slices.Clone(s.images),
	}
}

// MemStore 是 coldstart.Store 的記憶體實作；交易以「整個狀態的快照」實作，失敗時還原。
type MemStore struct {
	mu    sync.Mutex
	st    state
	seq   int
	clock time.Time
	// Users 是 ID → 顯示資訊（建立者、確認者）
	Users map[string]coldstart.UserRef
}

func NewMemStore() *MemStore {
	return &MemStore{
		st: state{
			submissions: map[string]coldstart.Submission{},
			products:    map[string]coldstart.Product{},
		},
		clock: time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC),
		Users: map[string]coldstart.UserRef{},
	}
}

var _ coldstart.Store = (*MemStore)(nil)

func (m *MemStore) nextID() string {
	m.seq++
	return fmt.Sprintf("00000000-0000-0000-0000-%012d", m.seq)
}

// tick 讓每次寫入的 updated_at 都不同（樂觀鎖）。
func (m *MemStore) tick() time.Time {
	m.clock = m.clock.Add(time.Millisecond)
	return m.clock
}

func (m *MemStore) user(id string) coldstart.UserRef {
	if u, ok := m.Users[id]; ok {
		return u
	}
	return coldstart.UserRef{ID: id}
}

func (m *MemStore) CreateSubmission(_ context.Context, userID string) (coldstart.Submission, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.tick()
	s := coldstart.Submission{
		ID: m.nextID(), Status: coldstart.StatusDraft, CreatedBy: m.user(userID), CreatedAt: now, UpdatedAt: now,
	}
	m.st.submissions[s.ID] = s
	return s, nil
}

func (m *MemStore) ListSubmissions(_ context.Context, status coldstart.Status, limit int) ([]coldstart.SubmissionSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []coldstart.SubmissionSummary
	for _, s := range m.st.submissions {
		if status != "" && s.Status != status {
			continue
		}
		sum := coldstart.SubmissionSummary{ID: s.ID, Status: s.Status, CreatedBy: s.CreatedBy, UpdatedAt: s.UpdatedAt, Images: []coldstart.Kind{}}
		if s.Draft.Barcode != nil {
			sum.Barcode = *s.Draft.Barcode
		}
		if s.Draft.Name != nil {
			sum.Name = *s.Draft.Name
		}
		for _, img := range s.Images {
			sum.Images = append(sum.Images, img.Kind)
		}
		out = append(out, sum)
	}
	slices.SortFunc(out, func(a, b coldstart.SubmissionSummary) int { return b.UpdatedAt.Compare(a.UpdatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *MemStore) GetSubmission(_ context.Context, id string) (coldstart.Submission, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.st.submissions[id]
	if !ok {
		return coldstart.Submission{}, coldstart.ErrNotFound
	}
	return s, nil
}

func (m *MemStore) ProductByGTIN(_ context.Context, gtin string) (coldstart.Product, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.productByGTIN(gtin)
}

func (m *MemStore) productByGTIN(gtin string) (coldstart.Product, error) {
	for id, p := range m.st.products {
		if p.GTIN == gtin {
			return m.product(id)
		}
	}
	return coldstart.Product{}, coldstart.ErrNotFound
}

func (m *MemStore) product(id string) (coldstart.Product, error) {
	p, ok := m.st.products[id]
	if !ok {
		return coldstart.Product{}, coldstart.ErrNotFound
	}
	p.Nutrition = map[coldstart.Basis]coldstart.NutritionFacts{}
	for _, n := range m.st.nutrition {
		if n.productID == id && !n.superseded {
			p.Nutrition[n.basis] = coldstart.NutritionFacts{Values: n.values, ConfirmedBy: m.user(n.confirmedBy), ConfirmedAt: n.confirmedAt}
		}
	}
	p.Images = []coldstart.ProductImage{}
	for _, r := range m.st.images {
		if r.productID == id {
			p.Images = append(p.Images, coldstart.ProductImage{Kind: r.img.Kind, SubmissionID: r.submissionID, Width: r.img.Width, Height: r.img.Height})
		}
	}
	return p, nil
}

// NutritionVersions 回傳某產品某基準的所有版本數（含已取代的），測試用。
func (m *MemStore) NutritionVersions(productID string, basis coldstart.Basis) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.st.nutrition {
		if r.productID == productID && r.basis == basis {
			n++
		}
	}
	return n
}

// InTx 以互斥鎖序列化交易；fn 失敗時還原到交易前的狀態。
func (m *MemStore) InTx(ctx context.Context, fn func(coldstart.Tx) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	snapshot := m.st.clone()
	if err := fn(memTx{m}); err != nil {
		m.st = snapshot
		return err
	}
	return nil
}

type memTx struct{ m *MemStore }

func (t memTx) LockSubmission(_ context.Context, id string) (coldstart.Submission, error) {
	s, ok := t.m.st.submissions[id]
	if !ok {
		return coldstart.Submission{}, coldstart.ErrNotFound
	}
	return s, nil
}

func (t memTx) SaveSubmission(_ context.Context, s coldstart.Submission) (coldstart.Submission, error) {
	if _, ok := t.m.st.submissions[s.ID]; !ok {
		return coldstart.Submission{}, coldstart.ErrNotFound
	}
	s.UpdatedAt = t.m.tick()
	if s.ConfirmedBy != nil {
		u := t.m.user(s.ConfirmedBy.ID)
		s.ConfirmedBy = &u
	}
	t.m.st.submissions[s.ID] = s
	return s, nil
}

func (t memTx) PutImage(_ context.Context, submissionID string, img coldstart.Image) (*coldstart.Image, error) {
	for i, r := range t.m.st.images {
		if r.submissionID == submissionID && r.img.Kind == img.Kind {
			old := r.img
			t.m.st.images[i].img = img
			return &old, nil
		}
	}
	t.m.st.images = append(t.m.st.images, imageRow{submissionID: submissionID, img: img})
	return nil, nil
}

func (t memTx) ProductByGTIN(_ context.Context, gtin string) (coldstart.Product, error) {
	return t.m.productByGTIN(gtin)
}

func (t memTx) ProductByID(_ context.Context, id string) (coldstart.Product, error) {
	return t.m.product(id)
}

func (t memTx) CreateProduct(_ context.Context, p coldstart.NewProduct) (string, error) {
	if _, err := t.m.productByGTIN(p.GTIN); err == nil {
		return "", coldstart.ErrGTINTaken
	}
	id := t.m.nextID()
	t.m.st.products[id] = coldstart.Product{
		ID: id, GTIN: p.GTIN, Barcode: p.Barcode, Name: p.Name, Brand: p.Brand, NetContent: p.NetContent,
		ContentUnit: p.ContentUnit, ServingSize: p.ServingSize, ServingsPerPackage: p.ServingsPerPackage,
		CreatedAt: t.m.tick(),
	}
	return id, nil
}

func (t memTx) AddNutrition(_ context.Context, productID string, basis coldstart.Basis, n coldstart.Nutrients, userID string) error {
	for i, r := range t.m.st.nutrition {
		if r.productID == productID && r.basis == basis && !r.superseded {
			t.m.st.nutrition[i].superseded = true
		}
	}
	t.m.st.nutrition = append(t.m.st.nutrition, nutritionRow{
		productID: productID, basis: basis, values: n, confirmedBy: userID, confirmedAt: t.m.tick(),
	})
	return nil
}

func (t memTx) AttachImages(_ context.Context, submissionID, productID string) error {
	for i, r := range t.m.st.images {
		if r.submissionID == submissionID {
			t.m.st.images[i].productID = productID
		}
	}
	return nil
}

// MemObjects 是 coldstart.Objects 的記憶體實作。
type MemObjects struct {
	mu   sync.Mutex
	Data map[string][]byte
}

func NewMemObjects() *MemObjects { return &MemObjects{Data: map[string][]byte{}} }

func (o *MemObjects) Put(_ context.Context, key string, data []byte, _ string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.Data[key] = slices.Clone(data)
	return nil
}

func (o *MemObjects) Get(_ context.Context, key string) ([]byte, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	d, ok := o.Data[key]
	if !ok {
		return nil, coldstart.ErrNotFound
	}
	return d, nil
}

func (o *MemObjects) Delete(_ context.Context, key string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.Data, key)
	return nil
}

// Keys 回傳目前所有物件的鍵（排序後），測試用。
func (o *MemObjects) Keys() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return slices.Sorted(maps.Keys(o.Data))
}

// FakePreprocessor 依照片種類回傳固定的摘要。
type FakePreprocessor map[coldstart.Kind]coldstart.ImagePreprocess

func (f FakePreprocessor) Preprocess(_ context.Context, kind coldstart.Kind, _ []byte) coldstart.ImagePreprocess {
	return f[kind]
}
