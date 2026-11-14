"""混合效果邏輯迴歸（隨機截距，自適應 Gauss–Hermite 最大概似）。"""

import math

import numpy as np
import pytest

from dietai.evaluation import (
    INTERCEPT,
    design_matrix,
    fit_mixed_logit,
    mixed_logit_from_rows,
    mixed_logit_table,
)
from dietai.evaluation.glmm import _logistic_start, _Model


def _simulate(n_groups=60, per=40, beta=(-0.5, 1.2, 0.0), sigma=1.0, seed=1):
    """兩個二元共變數、原始樣本隨機截距的模擬資料。"""
    rng = np.random.default_rng(seed)
    g = np.repeat(np.arange(n_groups), per)
    u = rng.normal(0.0, sigma, n_groups)
    x = np.column_stack([np.ones(len(g)), rng.integers(0, 2, (len(g), 2))]).astype(float)
    eta = x @ np.asarray(beta) + u[g]
    y = (rng.random(len(g)) < 1 / (1 + np.exp(-eta))).astype(float)
    return x, y, [f"s{i}" for i in g]


def test_recovers_known_parameters():
    x, y, groups = _simulate()
    res = fit_mixed_logit(x, y, groups, [INTERCEPT, "x1", "x2"])
    assert res.converged and res.warnings == ()
    assert res.n_obs == 2400 and res.n_clusters == 60
    b0, b1, b2 = res.coefficients
    assert abs(b0.estimate + 0.5) < 2.5 * b0.se
    assert abs(b1.estimate - 1.2) < 2.5 * b1.se and b1.p_value < 1e-6
    assert abs(b2.estimate) < 2.5 * b2.se and b2.p_value > 0.05  # 沒有效果的共變數
    assert 0.6 < res.sigma < 1.4
    # 勝算比與其信賴區間由係數換算
    assert b1.odds_ratio == pytest.approx(math.exp(b1.estimate))
    assert b1.or_low < b1.odds_ratio < b1.or_high


def test_clustered_se_wider_than_naive_logistic():
    """同一原始樣本的觀測相關：隨機截距模型的截距標準誤應大於當成獨立樣本的邏輯迴歸。"""
    x, y, groups = _simulate(sigma=1.5)
    res = fit_mixed_logit(x, y, groups, [INTERCEPT, "x1", "x2"])
    beta = _logistic_start(x, y)
    p = 1 / (1 + np.exp(-(x @ beta)))
    naive = np.sqrt(np.diag(np.linalg.inv(x.T @ (x * (p * (1 - p))[:, None]))))
    assert res.coefficients[0].se > 2 * naive[0]


def test_likelihood_matches_brute_force_integration():
    x, y, groups = _simulate(n_groups=8, per=25, sigma=1.3, seed=4)
    _, g = np.unique(groups, return_inverse=True)
    theta = np.array([-0.2, 0.9, 0.3, math.log(1.3)])
    value, _ = _Model(x, y, g, 8, 15).evaluate(theta)
    # 以細格點的梯形法直接積分每個原始樣本的邊際概似
    grid = np.linspace(-12, 12, 20001)
    eta = x @ theta[:-1]
    sigma = math.exp(theta[-1])
    prior = np.exp(-(grid**2) / (2 * sigma**2)) / math.sqrt(2 * math.pi * sigma**2)
    total = 0.0
    for i in range(8):
        e = eta[g == i][:, None] + grid[None, :]
        lik = np.exp((y[g == i][:, None] * e - np.logaddexp(0, e)).sum(axis=0))
        total += math.log(np.trapezoid(lik * prior, grid))
    assert value == pytest.approx(-total, rel=1e-7)


def test_gradient_matches_finite_differences():
    x, y, groups = _simulate(n_groups=10, per=20, seed=2)
    _, g = np.unique(groups, return_inverse=True)
    model = _Model(x, y, g, 10, 15)
    theta = np.array([0.1, 0.8, -0.3, 0.2])
    _, grad = model.evaluate(theta)
    h = 1e-5
    num = [
        (model.evaluate(theta + e)[0] - model.evaluate(theta - e)[0]) / (2 * h)
        for e in np.eye(4) * h
    ]
    np.testing.assert_allclose(grad, num, rtol=1e-4, atol=1e-5)


def test_cluster_scores_sum_to_gradient():
    """各原始樣本的分數加總就是對數概似的梯度（evaluate 回傳的是負梯度）。"""
    x, y, groups = _simulate(n_groups=10, per=20, seed=2)
    _, g = np.unique(groups, return_inverse=True)
    model = _Model(x, y, g, 10, 15)
    theta = np.array([0.1, 0.8, -0.3, 0.2])
    scores = model.scores(theta)
    assert scores.shape == (10, 4)
    np.testing.assert_allclose(scores.sum(axis=0), -model.evaluate(theta)[1], rtol=1e-10)


def _variant_level(sigma_v, n_sources=60, n_methods=15, seed=0):
    """每個原始樣本兩個條件（各一張變體）× 多個方法；同一張變體的結果共用變體層的隨機效果。

    條件與方法的真實效果都是 0。
    """
    rng = np.random.default_rng(seed)
    xs, ys, gs = [], [], []
    for s in range(n_sources):
        u = rng.normal(0, 1.0)
        for cond in (0.0, 1.0):
            v = rng.normal(0, sigma_v)
            for m in range(n_methods):
                ys.append(float(rng.random() < 1 / (1 + math.exp(-(0.3 + u + v)))))
                xs.append([1.0, cond, float(m % 2)])
                gs.append(f"s{s}")
    return np.asarray(xs), np.asarray(ys), gs


def test_robust_se_accounts_for_variant_level_correlation():
    """同一張變體被多個方法各解碼一次：條件這類整張變體共用的效果，模型的標準誤嚴重偏小。

    只有原始樣本隨機截距的模型把同一張圖的 15 筆結果當成獨立觀測；
    以原始樣本為集群的穩健標準誤（``se``，檢定用它）應明顯較大。型一錯誤率的模擬見 PR 說明。
    """
    x, y, groups = _variant_level(sigma_v=2.0)
    cond = fit_mixed_logit(x, y, groups, [INTERCEPT, "cond", "method"]).coefficient("cond")
    assert cond.se > 2 * cond.se_model
    # 檢定與信賴區間用的是穩健標準誤
    assert cond.z == pytest.approx(cond.estimate / cond.se)
    assert cond.or_high == pytest.approx(math.exp(cond.estimate + 1.959964 * cond.se))


def test_robust_se_matches_model_se_when_model_is_right():
    """沒有變體層的額外相關時（模型正確），穩健與模型的標準誤應接近。"""
    x, y, groups = _variant_level(sigma_v=0.0)
    res = fit_mixed_logit(x, y, groups, [INTERCEPT, "cond", "method"])
    for c in res.coefficients:
        assert 0.7 < c.se / c.se_model < 1.3, c.name


def test_few_clusters_warns_and_table_states_robust():
    x, y, groups = _simulate(n_groups=12, per=30, seed=3)
    res = fit_mixed_logit(x, y, groups, [INTERCEPT, "x1", "x2"])
    assert any("只有 12 個原始樣本" in w for w in res.warnings)
    assert "穩健（三明治）估計" in mixed_logit_table(res)
    # 集群夠多時不警告
    x, y, groups = _simulate()
    assert fit_mixed_logit(x, y, groups, [INTERCEPT, "x1", "x2"]).warnings == ()


def test_no_cluster_effect_hits_boundary_and_matches_logistic():
    # seed 0 的最大概似解恰在 σ = 0（其他 seed 可能因抽樣誤差得到小的正值，那也是正確的解）
    x, y, groups = _simulate(sigma=0.0, seed=0)
    res = fit_mixed_logit(x, y, groups, [INTERCEPT, "x1", "x2"])
    assert res.converged and res.sigma < 0.01
    assert any("接近 0" in w for w in res.warnings)
    # σ = 0 時即一般邏輯迴歸；起始值的脊懲罰極小，兩者應幾乎相同
    np.testing.assert_allclose(
        [c.estimate for c in res.coefficients], _logistic_start(x, y), atol=1e-2
    )
    assert all(math.isfinite(c.se) for c in res.coefficients)


def test_separation_is_flagged():
    x, y, groups = _simulate(seed=5)
    y = np.where(x[:, 2] == 1, 1.0, y)  # x2 = 1 時全部成功
    res = fit_mixed_logit(x, y, groups, [INTERCEPT, "x1", "x2"])
    assert any("x2" in w and "分離" in w for w in res.warnings)


def test_rejects_bad_input():
    x, y, groups = _simulate(n_groups=3, per=5)
    names = [INTERCEPT, "x1", "x2"]
    with pytest.raises(ValueError, match="0 或 1"):
        fit_mixed_logit(x, y * 2, groups, names)
    with pytest.raises(ValueError, match="不滿秩"):
        fit_mixed_logit(np.column_stack([x, x[:, 1]]), y, groups, [*names, "dup"])
    with pytest.raises(ValueError, match="兩個原始樣本"):
        fit_mixed_logit(x, y, ["only"] * len(y), names)
    with pytest.raises(ValueError, match="names"):
        fit_mixed_logit(x, y, groups, names[:2])


def test_design_matrix_treatment_coding_and_interactions():
    rows = [
        {"method": m, "condition": c} for m in ("raw", "clahe", "otsu") for c in ("clean", "blur")
    ]
    x, names = design_matrix(rows, ["method", "condition"], reference={"condition": "clean"})
    assert names == [INTERCEPT, "method=clahe", "method=otsu", "condition=blur"]
    assert x.shape == (6, 4)
    np.testing.assert_array_equal(x[:, 1], [0, 0, 1, 1, 0, 0])
    x, names = design_matrix(rows, ["method", "condition"], interactions=[("method", "condition")])
    assert names[-2:] == ["method=clahe×condition=blur", "method=otsu×condition=blur"]
    np.testing.assert_array_equal(x[:, -1], [0, 0, 0, 0, 0, 1])
    with pytest.raises(ValueError, match="參考水準"):
        design_matrix(rows, ["method"], reference={"method": "nope"})
    with pytest.raises(ValueError, match="factors"):
        design_matrix(rows, ["method"], interactions=[("method", "condition")])


def test_from_rows_uses_positives_and_source_id():
    rng = np.random.default_rng(0)
    rows = []
    for s in range(30):
        u = rng.normal(0, 1)
        for method, effect in (("raw", 0.0), ("clahe", 1.0)):
            for k in range(10):
                ok = rng.random() < 1 / (1 + math.exp(-(effect + u)))
                rows.append(
                    {
                        "id": f"s{s}_{k}",
                        "truth": "1",
                        "source_id": f"s{s}",
                        "method": method,
                        "outcome": "correct" if ok else "missed",
                    }
                )
    # 負樣本與 error 不納入
    rows += [
        {"id": "n", "truth": "", "source_id": "n", "method": "raw", "outcome": "true_negative"}
    ]
    rows += [{"id": "e", "truth": "1", "source_id": "e", "method": "raw", "outcome": "error"}]
    res = mixed_logit_from_rows(rows, ["method"], reference={"method": "raw"})
    assert res.n_obs == 600 and res.n_clusters == 30
    effect = res.coefficient("method=clahe")
    assert abs(effect.estimate - 1.0) < 2.5 * effect.se
    table = mixed_logit_table(res)
    assert "method=clahe" in table and "隨機截距標準差" in table
    with pytest.raises(KeyError):
        res.coefficient("nope")
    with pytest.raises(ValueError, match="正樣本"):
        mixed_logit_from_rows(rows[-2:], ["method"])
