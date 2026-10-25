//! Integer-only multi-player Elo: every player is scored head-to-head against
//! every other player by finishing place, and the K-scaled result is averaged.

use crate::constants::{ELO_K, MAX_RATING_DIFF};

/// Expected score (basis points) for a player rated `diff` above an opponent,
/// for diff = 0, 25, 50 … 800. Precomputed from 1 / (1 + 10^(-diff/400)).
const EXPECTED_BPS: [i64; 33] = [
    5000, 5359, 5715, 6063, 6401, 6725, 7034, 7325, 7597, 7850, 8083, 8296, 8490, 8666, 8823,
    8965, 9091, 9203, 9302, 9390, 9468, 9536, 9595, 9648, 9693, 9733, 9768, 9799, 9825, 9848,
    9868, 9886, 9901,
];
const STEP: i64 = 25;

/// Expected score in basis points (0..=10_000), linearly interpolated.
pub fn expected_bps(diff: i64) -> i64 {
    let d = diff.abs().min(MAX_RATING_DIFF);
    let i = (d / STEP) as usize;
    let lo = EXPECTED_BPS[i];
    let hi = *EXPECTED_BPS.get(i + 1).unwrap_or(&lo);
    let value = lo + (hi - lo) * (d % STEP) / STEP;
    if diff >= 0 {
        value
    } else {
        10_000 - value
    }
}

/// Rating change per player. `places[i]` is player i's finish (1 = best);
/// equal places count as a draw (split pot).
pub fn rating_deltas(ratings: &[u32], places: &[u8]) -> Vec<i64> {
    let n = ratings.len() as i64;
    (0..ratings.len())
        .map(|i| {
            let surplus: i64 = (0..ratings.len())
                .filter(|&j| j != i)
                .map(|j| {
                    let actual = match places[i].cmp(&places[j]) {
                        core::cmp::Ordering::Less => 10_000,
                        core::cmp::Ordering::Equal => 5_000,
                        core::cmp::Ordering::Greater => 0,
                    };
                    actual - expected_bps(ratings[i] as i64 - ratings[j] as i64)
                })
                .sum();
            let num = ELO_K * surplus;
            let den = (n - 1) * 10_000;
            // Round half away from zero.
            (num + num.signum() * den / 2) / den
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_score_matches_formula() {
        assert_eq!(expected_bps(0), 5000);
        assert_eq!(expected_bps(400), 9091);
        assert_eq!(expected_bps(-400), 909);
        assert_eq!(expected_bps(5000), 9901); // clamped
    }

    #[test]
    fn heads_up_even_match_moves_half_k() {
        assert_eq!(rating_deltas(&[1200, 1200], &[1, 2]), vec![16, -16]);
    }

    #[test]
    fn split_pot_between_equals_changes_nothing() {
        assert_eq!(rating_deltas(&[1200, 1200], &[1, 1]), vec![0, 0]);
    }

    #[test]
    fn upset_moves_more_than_expected_win() {
        let upset = rating_deltas(&[1000, 1400], &[1, 2]);
        let expected = rating_deltas(&[1400, 1000], &[1, 2]);
        assert!(upset[0] > expected[0]);
        assert_eq!(upset, vec![29, -29]);
    }

    #[test]
    fn three_way_table_is_zero_sum() {
        let d = rating_deltas(&[1200, 1300, 1100], &[2, 1, 3]);
        assert_eq!(d.iter().sum::<i64>(), 0);
        assert!(d[1] > 0 && d[2] < 0);
    }
}
