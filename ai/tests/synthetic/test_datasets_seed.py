"""合成資料集的種子規則（review D6）。"""

import json

from dietai.synthetic.datasets import SEED_SCHEME, item_seed, write_label_dataset


def test_item_seed_is_two_dimensional():
    # 舊規則 seed + i：seed=0 的第 1 項與 seed=1 的第 0 項同種子
    assert item_seed(0, 1) != item_seed(1, 0)
    assert item_seed(3, 2) == item_seed(3, 2)  # 可重現
    assert len({item_seed(s, i) for s in range(5) for i in range(5)}) == 25


def test_dataset_params_record_seed_scheme(tmp_path):
    manifest = write_label_dataset(tmp_path / "l", n=1)
    params = json.loads(manifest.with_suffix(".json").read_text(encoding="utf-8"))
    assert params["seed_scheme"] == SEED_SCHEME
