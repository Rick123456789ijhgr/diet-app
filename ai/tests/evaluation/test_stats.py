import pytest

from dietai.evaluation import (
    cluster_bootstrap_diff,
    holm,
    mcnemar_exact,
    paired_counts,
    wilson_interval,
)


@pytest.mark.parametrize(
    ("k", "n", "expected"),
    [
        (5, 10, (0.2366, 0.7634)),
        (0, 10, (0.0, 0.2775)),
        (10, 10, (0.7225, 1.0)),
        (81, 100, (0.7222, 0.8749)),
    ],
)
def test_wilson_known_values(k, n, expected):
    lo, hi = wilson_interval(k, n)
    assert lo == pytest.approx(expected[0], abs=1e-4)
    assert hi == pytest.approx(expected[1], abs=1e-4)


def test_wilson_narrows_with_more_samples():
    small = wilson_interval(5, 10)
    large = wilson_interval(500, 1000)
    assert large[1] - large[0] < small[1] - small[0]


def test_wilson_edge_cases():
    assert wilson_interval(0, 0) == (0.0, 1.0)
    with pytest.raises(ValueError):
        wilson_interval(3, 2)


@pytest.mark.parametrize(
    ("b", "c", "expected"),
    [(0, 0, 1.0), (0, 5, 0.0625), (1, 9, 22 / 1024), (3, 3, 1.0), (0, 1, 1.0)],
)
def test_mcnemar_exact_known_values(b, c, expected):
    assert mcnemar_exact(b, c) == pytest.approx(expected)
    assert mcnemar_exact(c, b) == pytest.approx(expected)


def test_mcnemar_rejects_negative():
    with pytest.raises(ValueError):
        mcnemar_exact(-1, 2)


def test_paired_counts():
    base = [True, True, False, False, True]
    other = [True, False, True, True, True]
    assert paired_counts(base, other) == (1, 2)
    with pytest.raises(ValueError):
        paired_counts([True], [])


# ---- 以原始樣本為單位：集群 bootstrap、置換檢定、Holm ----


def test_holm_known_values():
    adjusted = holm([0.01, 0.04, 0.03, 0.005])
    assert adjusted == pytest.approx([0.03, 0.06, 0.06, 0.02])
    assert holm([0.5, 0.9]) == pytest.approx([1.0, 1.0])
    assert holm([]) == []
    with pytest.raises(ValueError):
        holm([1.5])


def test_cluster_bootstrap_point_estimate_and_reproducible():
    clusters = [[(False, True), (True, True)], [(False, False)], [(True, False), (False, True)]]
    res = cluster_bootstrap_diff(clusters, n_boot=500, seed=1)
    assert (res.n_clusters, res.n_pairs) == (3, 5)
    assert (res.rate_baseline, res.rate_other) == pytest.approx((0.4, 0.6))
    assert res.diff == pytest.approx(0.2)
    assert res.ci_low <= res.diff <= res.ci_high
    assert cluster_bootstrap_diff(clusters, n_boot=500, seed=1) == res


def test_cluster_bootstrap_identical_arms():
    res = cluster_bootstrap_diff([[(True, True)], [(False, False)]], n_boot=200)
    assert (res.diff, res.ci_low, res.ci_high, res.p_value) == (0.0, 0.0, 0.0, 1.0)


def test_cluster_bootstrap_detects_consistent_gain():
    res = cluster_bootstrap_diff([[(False, True)]] * 30, n_boot=999)
    assert res.p_value == pytest.approx(1 / 1000)
    assert res.ci_low == res.ci_high == 1.0


def test_duplicated_variants_do_not_narrow_cluster_inference():
    # 12 個原始樣本：7 個前處理救回、3 個退步、2 個不變
    sources = [[(False, True)]] * 7 + [[(True, False)]] * 3 + [[(True, True)]] * 2
    # 每個原始樣本複製成 16 個完全相關的變體
    copies = [c * 16 for c in sources]
    one = cluster_bootstrap_diff(sources, n_boot=2000, seed=3)
    many = cluster_bootstrap_diff(copies, n_boot=2000, seed=3)
    assert (many.ci_low, many.ci_high, many.p_value) == (one.ci_low, one.ci_high, one.p_value)
    assert one.p_value > 0.05
    # 以變體為單位的 McNemar 把 16 份複製當成獨立樣本，p 值失真地變小
    assert mcnemar_exact(3, 7) > 0.05 and mcnemar_exact(48, 112) < 1e-5


def test_cluster_bootstrap_validation():
    with pytest.raises(ValueError, match="沒有任何配對"):
        cluster_bootstrap_diff([[], []])
    with pytest.raises(ValueError):
        cluster_bootstrap_diff([[(True, True)]], n_boot=0)
