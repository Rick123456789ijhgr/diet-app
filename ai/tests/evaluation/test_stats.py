import pytest

from dietai.evaluation import mcnemar_exact, paired_counts, wilson_interval


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
