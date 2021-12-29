//! Utility functions for calculating unlock schedules for a release account.

use crate::Release;
use num_traits::ToPrimitive;

pub fn available_for_withdrawal(release: &Release, current_ts: i64) -> u64 {
    std::cmp::min(outstanding_released(release, current_ts), balance(release))
}

// The amount of funds currently in the vault.
fn balance(release: &Release) -> u64 {
    release.outstanding
}

// The amount of outstanding locked tokens released.
fn outstanding_released(release: &Release, current_ts: i64) -> u64 {
    total_released(release, current_ts)
        .checked_sub(withdrawn_amount(release))
        .unwrap()
}

// Returns the amount withdrawn from this release account.
fn withdrawn_amount(release: &Release) -> u64 {
    release
        .start_balance
        .checked_sub(release.outstanding)
        .unwrap()
}

// Returns the total released amount up to the given ts, assuming zero
// withdrawals and zero funds sent to other programs.
fn total_released(release: &Release, current_ts: i64) -> u64 {
    if current_ts < release.start_ts {
        0
    } else if current_ts >= release.end_ts {
        release.start_balance
    } else {
        linear_unlock(release, current_ts).unwrap()
    }
}

fn linear_unlock(release: &Release, current_ts: i64) -> Option<u64> {
    // Signed division not supported.
    let current_ts = current_ts as u64;
    let start_ts = release.start_ts as u64;
    let end_ts = release.end_ts as u64;

    if current_ts <= start_ts {
        return Some(0);
    }

    if current_ts >= end_ts {
        return Some(release.start_balance);
    }

    (current_ts.checked_sub(start_ts)? as u128)
        .checked_mul(release.start_balance.into())?
        .checked_div(end_ts.checked_sub(start_ts)?.into())?
        .to_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_unlock_not_started() {
        let release = &mut Release::default();
        release.start_ts = 100_000;
        release.end_ts = 200_000;
        release.start_balance = 1_000_000;
        let amt = linear_unlock(release, 90_000).unwrap();
        assert_eq!(amt, 0);
    }

    #[test]
    fn test_linear_unlock_finished() {
        let release = &mut Release::default();
        release.start_ts = 100_000;
        release.end_ts = 200_000;
        release.start_balance = 1_000_000;
        let amt = linear_unlock(release, 290_000).unwrap();
        assert_eq!(amt, 1_000_000);
    }

    #[test]
    fn test_linear_unlock_halfway() {
        let release = &mut Release::default();
        release.start_ts = 100_000;
        release.end_ts = 200_000;
        release.start_balance = 1_000_000;
        let amt = linear_unlock(release, 150_000).unwrap();
        assert_eq!(amt, 500_000);
    }
}
