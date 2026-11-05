"""混合效果邏輯迴歸：固定效果為前處理方法、劣化條件等，原始樣本為隨機截距（設計 9.1 節輔助方法）。

模型：``logit P(y_ij = 1) = x_ij·β + u_i``，``u_i ~ N(0, σ²)``，``i`` 為原始樣本（``source_id``），
``j`` 為該原始樣本的各變體 × 方法。同一原始樣本的結果共用 ``u_i``，因此係數的標準誤
不會像「把變體當成獨立樣本」那樣被低估（ADR 0005 第 4、9 點）。

估計方法為**自適應 Gauss–Hermite 積分的最大概似**（同 R ``lme4::glmer`` 的 ``nAGQ > 1``）：
每個原始樣本先以牛頓法找出 ``u_i`` 的後驗眾數與曲率，在其附近放積分點計算邊際概似；
參數以 BFGS 求解，梯度為後驗期望的解析式，標準誤取自梯度有限差分得到的 Hessian 反矩陣。
只用 numpy（不訓練模型，屬統計方法；專案規則 5）。

完全分離（某個分組全對或全錯）時最大概似估計不存在，係數會往 ±∞ 漂移；
結果的 ``warnings`` 會標出這些係數，報告時應合併分組或改報集群 bootstrap。
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from dietai.evaluation.manifest import SOURCE_COLUMN

INTERCEPT = "(截距)"
_LOG_SIGMA_RANGE = (-8.0, 4.0)  # σ 約 0.0003～55；超出時視為邊界解
_SEPARATION_ABS = 10.0  # |係數| 超過此值（勝算比 > 2 萬倍）視為可能完全分離

Array = npt.NDArray[np.float64]


@dataclass(frozen=True)
class Coefficient:
    """一個固定效果：估計值、標準誤、Wald 檢定，以及勝算比與其 95% 信賴區間。"""

    name: str
    estimate: float
    se: float
    z: float
    p_value: float
    odds_ratio: float
    or_low: float
    or_high: float


@dataclass(frozen=True)
class MixedLogitResult:
    """``fit_mixed_logit`` 的結果。``sigma`` 為隨機截距的標準差（logit 尺度）。"""

    coefficients: tuple[Coefficient, ...]
    sigma: float
    log_likelihood: float
    n_obs: int
    n_clusters: int
    converged: bool
    iterations: int
    warnings: tuple[str, ...]

    def coefficient(self, name: str) -> Coefficient:
        """依名稱取固定效果；找不到時丟 ``KeyError``。"""
        for c in self.coefficients:
            if c.name == name:
                return c
        raise KeyError(name)


def fit_mixed_logit(
    x: npt.ArrayLike,
    y: npt.ArrayLike,
    groups: Sequence[str],
    names: Sequence[str],
    *,
    n_quad: int = 15,
    max_iter: int = 200,
    tol: float = 1e-4,
) -> MixedLogitResult:
    """以自適應 Gauss–Hermite 最大概似擬合隨機截距邏輯迴歸。

    ``x`` 為 (觀測數, 係數數) 的設計矩陣（須含截距欄，見 ``design_matrix``），``y`` 為 0／1，
    ``groups`` 為每個觀測所屬的原始樣本，``names`` 為各欄名稱。``n_quad`` 為每個原始樣本的
    積分點數；``tol`` 為梯度最大分量的收斂門檻。至少要兩個原始樣本，否則 σ 無法估計。
    """
    xm = np.asarray(x, dtype=np.float64)
    yv = np.asarray(y, dtype=np.float64)
    if xm.ndim != 2 or len(yv) != len(xm) or len(groups) != len(xm):
        raise ValueError("x 須為二維，且 x、y、groups 的觀測數相同")
    if len(names) != xm.shape[1]:
        raise ValueError(f"names 有 {len(names)} 個，x 有 {xm.shape[1]} 欄")
    if not np.isin(yv, (0.0, 1.0)).all():
        raise ValueError("y 只能是 0 或 1")
    if np.linalg.matrix_rank(xm) < xm.shape[1]:
        raise ValueError("設計矩陣不滿秩（有欄位是其他欄位的線性組合，或某個水準沒有觀測）")
    levels, g = np.unique(np.asarray(groups, dtype=object), return_inverse=True)
    if len(levels) < 2:
        raise ValueError("至少要兩個原始樣本才能估計隨機截距")
    model = _Model(xm, yv, g.astype(np.intp), len(levels), n_quad)

    start = np.append(_logistic_start(xm, yv), 0.0)  # σ 從 1 開始
    theta, value, converged, iters = _bfgs(model.evaluate, start, max_iter, tol)
    log_sigma = float(np.clip(theta[-1], *_LOG_SIGMA_RANGE))
    theta[-1] = log_sigma
    # σ 落在下界（原始樣本之間沒有差異）時，該方向的概似是平的、Hessian 奇異：
    # 同 glmer 的邊界解，固定 σ 後只以 β 的區塊計算標準誤
    boundary = log_sigma <= _LOG_SIGMA_RANGE[0] + 0.5
    warnings: list[str] = []
    try:
        if boundary:

            def f_beta(b: Array) -> tuple[float, Array]:
                value, grad = model.evaluate(np.append(b, log_sigma))
                return value, grad[:-1]

            hessian = _hessian(f_beta, theta[:-1])
        else:
            hessian = _hessian(model.evaluate, theta)
        variances = np.diag(np.linalg.inv(hessian))
        if not np.isfinite(variances).all() or (variances <= 0).any():
            raise np.linalg.LinAlgError
        se = np.sqrt(variances)
    except np.linalg.LinAlgError:
        se = np.full(len(theta), np.nan)
        warnings.append("Hessian 不是正定，標準誤無法計算")
    if not converged:
        warnings.append(f"最佳化在 {iters} 次迭代內未收斂")
    if boundary:
        warnings.append("隨機截距標準差接近 0（原始樣本之間沒有可見差異）")

    coefs: list[Coefficient] = []
    for i, name in enumerate(names):
        b, s = float(theta[i]), float(se[i])
        z = b / s if s > 0 else math.nan
        p = math.erfc(abs(z) / math.sqrt(2)) if math.isfinite(z) else math.nan
        coefs.append(
            Coefficient(name, b, s, z, p, _exp(b), _exp(b - 1.959964 * s), _exp(b + 1.959964 * s))
        )
        if abs(b) > _SEPARATION_ABS:
            warnings.append(f"{name} 的係數過大，可能完全分離（某分組全對或全錯），不可信")
    return MixedLogitResult(
        coefficients=tuple(coefs),
        sigma=math.exp(log_sigma),
        log_likelihood=-value,
        n_obs=len(yv),
        n_clusters=len(levels),
        converged=converged,
        iterations=iters,
        warnings=tuple(warnings),
    )


def design_matrix(
    rows: Sequence[Mapping[str, str]],
    factors: Sequence[str],
    *,
    interactions: Sequence[tuple[str, str]] = (),
    reference: Mapping[str, str] | None = None,
) -> tuple[Array, list[str]]:
    """把類別欄位編成設計矩陣（處理編碼：每個因子以一個參考水準為基準）。

    欄位依序為截距、各因子除參考水準外的每個水準（``因子=水準``），再接 ``interactions``
    中每對因子的乘積（``a=水準×b=水準``；全為 0 的欄位略去）。參考水準預設為該因子
    第一次出現的值；``reference`` 可指定（例如 ``{"method": "raw", "condition": "clean"}``）。
    """
    reference = dict(reference or {})
    dummies: dict[str, list[tuple[str, Array]]] = {}
    for f in factors:
        values = [r.get(f, "") for r in rows]
        levels = list(dict.fromkeys(values))
        ref = reference.get(f, levels[0] if levels else "")
        if ref not in levels:
            raise ValueError(f"{f} 沒有參考水準 {ref!r}；可用：{levels}")
        arr = np.asarray(values, dtype=object)
        dummies[f] = [(lv, (arr == lv).astype(np.float64)) for lv in levels if lv != ref]
    columns: list[Array] = [np.ones(len(rows))]
    names = [INTERCEPT]
    for f in factors:
        for lv, col in dummies[f]:
            columns.append(col)
            names.append(f"{f}={lv}")
    for a, b in interactions:
        if a not in dummies or b not in dummies:
            raise ValueError(f"交互作用 {a}×{b} 的因子須列在 factors 中")
        for la, ca in dummies[a]:
            for lb, cb in dummies[b]:
                col = ca * cb
                if col.any():
                    columns.append(col)
                    names.append(f"{a}={la}×{b}={lb}")
    return np.column_stack(columns), names


def mixed_logit_from_rows(
    rows: Sequence[Mapping[str, str]],
    factors: Sequence[str],
    *,
    success: str = "correct",
    cluster: str = SOURCE_COLUMN,
    interactions: Sequence[tuple[str, str]] = (),
    reference: Mapping[str, str] | None = None,
    n_quad: int = 15,
) -> MixedLogitResult:
    """由結果表（E1／E3 的各列）擬合：只用正樣本、排除 error；``outcome == success`` 為 1。

    原始樣本取 ``cluster`` 欄，沒有此欄時以 ``id`` 代替（每張影像各自一個集群）。
    """
    used = [r for r in rows if r.get("truth") and r.get("outcome") != "error"]
    if not used:
        raise ValueError("沒有可用的正樣本")
    x, names = design_matrix(used, factors, interactions=interactions, reference=reference)
    y = [1.0 if r["outcome"] == success else 0.0 for r in used]
    groups = [r.get(cluster) or r["id"] for r in used]
    return fit_mixed_logit(x, y, groups, names, n_quad=n_quad)


def mixed_logit_table(result: MixedLogitResult) -> str:
    """Markdown 表格：各固定效果的勝算比、95% 信賴區間與 p 值，表後附 σ 與警告。"""
    head = ["固定效果", "係數", "標準誤", "勝算比", "95% CI", "p 值"]
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for c in result.coefficients:
        ci = "—" if math.isnan(c.se) else f"{c.or_low:.3g}–{c.or_high:.3g}"
        p = "—" if math.isnan(c.p_value) else f"{c.p_value:.3g}"
        cells = [c.name, f"{c.estimate:.3f}", f"{c.se:.3f}", f"{c.odds_ratio:.3g}", ci, p]
        out.append("| " + " | ".join(cells) + " |")
    out += [
        "",
        f"隨機截距標準差 σ = {result.sigma:.3f}（{result.n_clusters} 個原始樣本、"
        f"{result.n_obs} 筆觀測；對數概似 {result.log_likelihood:.1f}）",
    ]
    out += [f"> 注意：{w}" for w in result.warnings]
    return "\n".join(out)


# ---------------------------------------------------------------- 內部實作


def _exp(v: float) -> float:
    """``exp``，溢位時回傳 ``inf``（分離的係數）。"""
    return math.exp(v) if v < 700 else math.inf


def _expit(v: Array) -> Array:
    """logistic 函數，大負值不溢位。"""
    return np.asarray(np.exp(-np.logaddexp(0.0, -v)), dtype=np.float64)


class _Model:
    """隨機截距邏輯迴歸的負對數概似與梯度（參數為 β 與 log σ）。"""

    def __init__(self, x: Array, y: Array, g: npt.NDArray[np.intp], n_groups: int, n_quad: int):
        self.x, self.y, self.g, self.n = x, y, g, n_groups
        nodes, weights = np.polynomial.hermite.hermgauss(n_quad)
        self.t = nodes
        # 積分 ∫ f(u) du ≈ √2·s·Σ w_k·e^{t_k²}·f(û + √2·s·t_k)；e^{t²} 先併入權重（取對數）
        self.log_w = np.log(weights) + nodes**2

    def _sum(self, values: Array) -> Array:
        """依原始樣本加總。"""
        return np.asarray(np.bincount(self.g, values, minlength=self.n), dtype=np.float64)

    def _modes(self, eta: Array, inv_var: float) -> tuple[Array, Array]:
        """各原始樣本 u 的後驗眾數與後驗標準差（牛頓法；目標為嚴格凹函數）。"""
        u = np.zeros(self.n)
        for _ in range(100):
            p = _expit(eta + u[self.g])
            grad = self._sum(self.y - p) - u * inv_var
            curv = self._sum(p * (1 - p)) + inv_var
            # 限制每步幅度：某原始樣本全對或全錯時，第一步可能跨得太遠
            step = np.clip(grad / curv, -5.0, 5.0)
            u += step
            if np.abs(step).max() < 1e-10:
                break
        p = _expit(eta + u[self.g])
        return u, 1.0 / np.sqrt(self._sum(p * (1 - p)) + inv_var)

    def evaluate(self, theta: Array) -> tuple[float, Array]:
        """回傳（負對數概似, 對 θ 的梯度）。"""
        beta = theta[:-1]
        log_sigma = float(np.clip(theta[-1], *_LOG_SIGMA_RANGE))
        var = math.exp(2 * log_sigma)
        eta = self.x @ beta
        mode, scale = self._modes(eta, 1.0 / var)
        # u_ik：每個原始樣本 × 積分點的隨機截距值
        u = mode[:, None] + math.sqrt(2) * scale[:, None] * self.t[None, :]
        e = eta[:, None] + u[self.g]
        loglik = np.stack(
            [self._sum(self.y * e[:, k] - np.logaddexp(0.0, e[:, k])) for k in range(len(self.t))],
            axis=1,
        )
        log_prior = -0.5 * math.log(2 * math.pi * var) - u**2 / (2 * var)
        terms = self.log_w[None, :] + loglik + log_prior
        top = terms.max(axis=1, keepdims=True)
        log_int = top[:, 0] + np.log(np.exp(terms - top).sum(axis=1))
        log_l = np.log(math.sqrt(2) * scale) + log_int
        # 後驗權重 π_ik：梯度為後驗期望（∂/∂β = E[Σ_j (y − p)·x]；∂/∂logσ = E[u²/σ² − 1]）
        post = np.exp(terms - log_int[:, None])
        resid = (post[self.g] * (self.y[:, None] - _expit(e))).sum(axis=1)
        grad_beta = self.x.T @ resid
        grad_sigma = float((post * (u**2 / var - 1.0)).sum())
        # 在 σ 的上下界外概似是平的（log σ 被截斷）：往界外的方向梯度設為 0，
        # BFGS 才會停在邊界上而不是一直往外走
        lo, hi = _LOG_SIGMA_RANGE
        if (theta[-1] <= lo and grad_sigma < 0) or (theta[-1] >= hi and grad_sigma > 0):
            grad_sigma = 0.0
        return -float(log_l.sum()), -np.append(grad_beta, grad_sigma)


def _logistic_start(x: Array, y: Array) -> Array:
    """不考慮集群的一般邏輯迴歸（IRLS，加極小的脊懲罰避免分離時發散），作為起始值。"""
    beta: Array = np.zeros(x.shape[1])
    ridge = 1e-3 * np.eye(x.shape[1])
    for _ in range(25):
        p = _expit(x @ beta)
        w = p * (1 - p)
        step = np.linalg.solve(x.T @ (x * w[:, None]) + ridge, x.T @ (y - p) - ridge @ beta)
        beta = np.asarray(np.clip(beta + step, -_SEPARATION_ABS, _SEPARATION_ABS), dtype=np.float64)
        if np.abs(step).max() < 1e-8:
            break
    return beta


def _bfgs(
    f: Callable[[Array], tuple[float, Array]], x0: Array, max_iter: int, tol: float
) -> tuple[Array, float, bool, int]:
    """BFGS（回溯線搜尋）；回傳（解, 函數值, 是否收斂, 迭代次數）。"""
    x = x0.copy()
    fx, g = f(x)
    h = np.eye(len(x))
    for it in range(max_iter):
        if np.abs(g).max() < tol:
            return x, fx, True, it
        d = -h @ g
        if g @ d >= 0:  # 近似的反 Hessian 失去正定性時重設
            h, d = np.eye(len(x)), -g
        norm = float(np.linalg.norm(d))
        if norm > 2.0:  # 每步最多走 2（logit 尺度），避免起始時一步跨到分離區
            d *= 2.0 / norm
        step = 1.0
        while True:
            xn = x + step * d
            fn, gn = f(xn)
            if fn <= fx + 1e-4 * step * float(g @ d):
                break
            step *= 0.5
            if step < 1e-12:
                return x, fx, False, it
        s, yv = xn - x, gn - g
        sy = float(s @ yv)
        if sy > 1e-12:
            rho = 1.0 / sy
            eye = np.eye(len(x))
            h = (eye - rho * np.outer(s, yv)) @ h @ (eye - rho * np.outer(yv, s))
            h += rho * np.outer(s, s)
        x, fx, g = xn, fn, gn
    return x, fx, np.abs(g).max() < tol, max_iter


def _hessian(f: Callable[[Array], tuple[float, Array]], x: Array, h: float = 1e-4) -> Array:
    """以解析梯度的中央差分求 Hessian，並對稱化。"""
    cols = []
    for i in range(len(x)):
        e = np.zeros(len(x))
        e[i] = h
        cols.append((f(x + e)[1] - f(x - e)[1]) / (2 * h))
    m = np.column_stack(cols)
    return np.asarray((m + m.T) / 2, dtype=np.float64)
