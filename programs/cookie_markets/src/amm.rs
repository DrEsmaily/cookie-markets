use anchor_lang::prelude::*;

use crate::{CookieMarketsError, MarketOutcome};

pub const AMM_FEE_BPS: u64 = 100;
pub const AMM_TRADE_CAP_BPS: u64 = 100;
pub const MAX_SLIPPAGE_BPS: u64 = 100;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MINIMUM_INITIAL_LIQUIDITY_TOKENS: u64 = 100;
pub const DEFERRED_FEE_FLAG: u64 = 1 << 63;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AmmQuote {
    pub gross_input: u64,
    pub fee: u64,
    pub net_input: u64,
    pub shares_out: u64,
    pub yes_reserve_after: u64,
    pub no_reserve_after: u64,
    pub liquidity_after: u64,
}

pub fn minimum_initial_liquidity(decimals: u8) -> Result<u64> {
    let scale = 10_u64
        .checked_pow(decimals.into())
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    MINIMUM_INITIAL_LIQUIDITY_TOKENS
        .checked_mul(scale)
        .ok_or_else(|| error!(CookieMarketsError::ArithmeticOverflow))
}

pub fn initial_reserves(liquidity: u64, yes_probability_bps: u16) -> Result<(u64, u64)> {
    require!(
        (1..BPS_DENOMINATOR as u16).contains(&yes_probability_bps),
        CookieMarketsError::InvalidStartingProbability
    );
    let yes_weight = u64::from(BPS_DENOMINATOR as u16 - yes_probability_bps);
    let no_weight = u64::from(yes_probability_bps);
    let largest = yes_weight.max(no_weight);
    let yes_reserve = multiply_divide_floor(liquidity, yes_weight, largest)?;
    let no_reserve = multiply_divide_floor(liquidity, no_weight, largest)?;
    require!(
        yes_reserve > 0 && no_reserve > 0,
        CookieMarketsError::PoolTooSmall
    );
    Ok((yes_reserve, no_reserve))
}

pub fn maximum_trade(liquidity: u64) -> Result<u64> {
    let maximum = multiply_divide_floor(liquidity, AMM_TRADE_CAP_BPS, BPS_DENOMINATOR)?;
    require!(maximum > 0, CookieMarketsError::PoolTooSmall);
    Ok(maximum)
}

pub fn deferred_fees(value: u64) -> bool {
    value & DEFERRED_FEE_FLAG != 0
}

pub fn creator_fees(value: u64) -> u64 {
    value & !DEFERRED_FEE_FLAG
}

pub fn add_creator_fee(value: u64, fee: u64) -> Result<u64> {
    let flag = value & DEFERRED_FEE_FLAG;
    creator_fees(value)
        .checked_add(fee)
        .filter(|total| *total < DEFERRED_FEE_FLAG)
        .map(|total| flag | total)
        .ok_or_else(|| error!(CookieMarketsError::ArithmeticOverflow))
}

pub fn quote_whole_shares(
    buy_yes: bool,
    shares_out: u64,
    maximum_total_input: u64,
    liquidity: u64,
    yes_reserve: u64,
    no_reserve: u64,
) -> Result<AmmQuote> {
    require!(shares_out > 0, CookieMarketsError::ZeroAmount);
    require!(
        yes_reserve > 0 && no_reserve > 0,
        CookieMarketsError::PoolTooSmall
    );
    let maximum_net_input = maximum_trade(liquidity)?;
    let invariant = u128::from(yes_reserve)
        .checked_mul(u128::from(no_reserve))
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    let (bought_reserve, opposite_reserve) = if buy_yes {
        (yes_reserve, no_reserve)
    } else {
        (no_reserve, yes_reserve)
    };
    let preserves_invariant = |net_input: u64| -> Result<bool> {
        let bought_after = bought_reserve
            .checked_add(net_input)
            .and_then(|value| value.checked_sub(shares_out));
        let opposite_after = opposite_reserve
            .checked_add(net_input)
            .ok_or(CookieMarketsError::ArithmeticOverflow)?;
        Ok(bought_after
            .map(|value| u128::from(value) * u128::from(opposite_after) >= invariant)
            .unwrap_or(false))
    };
    require!(
        preserves_invariant(maximum_net_input)?,
        CookieMarketsError::TradeExceedsPoolCap
    );
    let (mut low, mut high) = (1_u64, maximum_net_input);
    while low < high {
        let middle = low + (high - low) / 2;
        if preserves_invariant(middle)? {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    let net_input = low;
    let fee = multiply_divide_ceil(net_input, AMM_FEE_BPS, BPS_DENOMINATOR)?;
    let gross_input = net_input
        .checked_add(fee)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    require!(
        gross_input <= maximum_total_input,
        CookieMarketsError::SlippageExceeded
    );
    let bought_after = bought_reserve
        .checked_add(net_input)
        .and_then(|value| value.checked_sub(shares_out))
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    let opposite_after = opposite_reserve
        .checked_add(net_input)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    let liquidity_after = liquidity
        .checked_add(net_input)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    Ok(AmmQuote {
        gross_input,
        fee,
        net_input,
        shares_out,
        yes_reserve_after: if buy_yes {
            bought_after
        } else {
            opposite_after
        },
        no_reserve_after: if buy_yes {
            opposite_after
        } else {
            bought_after
        },
        liquidity_after,
    })
}

pub fn minimum_shares_with_one_percent_slippage(quoted_shares: u64) -> Result<u64> {
    require!(quoted_shares > 0, CookieMarketsError::TradeTooSmall);
    let minimum = multiply_divide_floor(
        quoted_shares,
        BPS_DENOMINATOR - MAX_SLIPPAGE_BPS,
        BPS_DENOMINATOR,
    )?;
    require!(minimum > 0, CookieMarketsError::TradeTooSmall);
    Ok(minimum)
}

pub fn quote_buy(
    buy_yes: bool,
    gross_input: u64,
    liquidity: u64,
    yes_reserve: u64,
    no_reserve: u64,
) -> Result<AmmQuote> {
    require!(gross_input > 0, CookieMarketsError::ZeroAmount);
    require!(
        gross_input <= maximum_trade(liquidity)?,
        CookieMarketsError::TradeExceedsPoolCap
    );
    require!(
        yes_reserve > 0 && no_reserve > 0,
        CookieMarketsError::PoolTooSmall
    );
    let fee = multiply_divide_ceil(gross_input, AMM_FEE_BPS, BPS_DENOMINATOR)?;
    let net_input = gross_input
        .checked_sub(fee)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    require!(net_input > 0, CookieMarketsError::TradeTooSmall);
    let invariant = u128::from(yes_reserve)
        .checked_mul(u128::from(no_reserve))
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    let (bought_reserve, opposite_reserve) = if buy_yes {
        (yes_reserve, no_reserve)
    } else {
        (no_reserve, yes_reserve)
    };
    let opposite_after = opposite_reserve
        .checked_add(net_input)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    let bought_before_output = bought_reserve
        .checked_add(net_input)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    let bought_after = divide_ceil(invariant, u128::from(opposite_after))?;
    let bought_after =
        u64::try_from(bought_after).map_err(|_| CookieMarketsError::ArithmeticOverflow)?;
    let shares_out = bought_before_output
        .checked_sub(bought_after)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    require!(shares_out > 0, CookieMarketsError::TradeTooSmall);
    let liquidity_after = liquidity
        .checked_add(net_input)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    let (yes_reserve_after, no_reserve_after) = if buy_yes {
        (bought_after, opposite_after)
    } else {
        (opposite_after, bought_after)
    };
    let invariant_after = u128::from(yes_reserve_after)
        .checked_mul(u128::from(no_reserve_after))
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    require!(
        invariant_after >= invariant,
        CookieMarketsError::PoolInvariantViolation
    );
    Ok(AmmQuote {
        gross_input,
        fee,
        net_input,
        shares_out,
        yes_reserve_after,
        no_reserve_after,
        liquidity_after,
    })
}

pub fn yes_probability_bps(yes_reserve: u64, no_reserve: u64) -> Result<u16> {
    let total = yes_reserve
        .checked_add(no_reserve)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    require!(total > 0, CookieMarketsError::PoolTooSmall);
    let probability = multiply_divide_floor(no_reserve, BPS_DENOMINATOR, total)?;
    u16::try_from(probability).map_err(|_| error!(CookieMarketsError::ArithmeticOverflow))
}

pub fn creator_pool_claim(
    outcome: MarketOutcome,
    yes_reserve: u64,
    no_reserve: u64,
) -> Result<u64> {
    match outcome {
        MarketOutcome::Yes => Ok(yes_reserve),
        MarketOutcome::No => Ok(no_reserve),
        MarketOutcome::Invalid => yes_reserve
            .checked_add(no_reserve)
            .ok_or_else(|| error!(CookieMarketsError::ArithmeticOverflow))
            .map(|total| total / 2),
        MarketOutcome::Unresolved => err!(CookieMarketsError::InvalidMarketState),
    }
}

fn multiply_divide_floor(value: u64, multiplier: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, CookieMarketsError::ArithmeticOverflow);
    let result = u128::from(value)
        .checked_mul(u128::from(multiplier))
        .ok_or(CookieMarketsError::ArithmeticOverflow)?
        / u128::from(denominator);
    u64::try_from(result).map_err(|_| error!(CookieMarketsError::ArithmeticOverflow))
}

fn multiply_divide_ceil(value: u64, multiplier: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, CookieMarketsError::ArithmeticOverflow);
    let numerator = u128::from(value)
        .checked_mul(u128::from(multiplier))
        .ok_or(CookieMarketsError::ArithmeticOverflow)?;
    let result = divide_ceil(numerator, u128::from(denominator))?;
    u64::try_from(result).map_err(|_| error!(CookieMarketsError::ArithmeticOverflow))
}

fn divide_ceil(numerator: u128, denominator: u128) -> Result<u128> {
    require!(denominator > 0, CookieMarketsError::ArithmeticOverflow);
    Ok(numerator
        .checked_add(denominator - 1)
        .ok_or(CookieMarketsError::ArithmeticOverflow)?
        / denominator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimum_liquidity_supports_one_percent_whole_share_trades() {
        assert_eq!(minimum_initial_liquidity(9).unwrap(), 100_000_000_000);
        assert_eq!(
            maximum_trade(minimum_initial_liquidity(9).unwrap()).unwrap(),
            1_000_000_000
        );
    }

    #[test]
    fn initial_reserves_match_requested_probabilities() {
        assert_eq!(
            initial_reserves(1_000_000, 5_000).unwrap(),
            (1_000_000, 1_000_000)
        );
        assert_eq!(
            initial_reserves(1_000_000, 7_000).unwrap(),
            (428_571, 1_000_000)
        );
        let (yes, no) = initial_reserves(1_000_000, 3_000).unwrap();
        assert!(yes_probability_bps(yes, no).unwrap().abs_diff(3_000) <= 1);
        assert!(initial_reserves(1_000_000, 0).is_err());
        assert!(initial_reserves(1_000_000, 10_000).is_err());
    }

    #[test]
    fn trades_enforce_fee_cap_and_invariant() {
        let quote = quote_buy(true, 10_000, 1_000_000, 1_000_000, 1_000_000).unwrap();
        assert_eq!(quote.fee, 100);
        assert_eq!(quote.net_input, 9_900);
        assert!(quote.shares_out > quote.net_input);
        assert_eq!(quote.liquidity_after, 1_009_900);
        assert!(
            u128::from(quote.yes_reserve_after) * u128::from(quote.no_reserve_after)
                >= 1_000_000_000_000
        );
        assert!(quote_buy(true, 10_001, 1_000_000, 1_000_000, 1_000_000).is_err());
    }

    #[test]
    fn whole_share_quotes_return_exact_integer_inventory() {
        let quote =
            quote_whole_shares(true, 5_000, 10_000, 1_000_000, 1_000_000, 1_000_000).unwrap();
        assert_eq!(quote.shares_out, 5_000);
        assert_eq!(quote.gross_input, quote.net_input + quote.fee);
        assert!(
            u128::from(quote.yes_reserve_after) * u128::from(quote.no_reserve_after)
                >= 1_000_000_000_000
        );
        assert!(quote_whole_shares(
            true,
            5_000,
            quote.gross_input - 1,
            1_000_000,
            1_000_000,
            1_000_000
        )
        .is_err());
    }

    #[test]
    fn deferred_fee_marker_preserves_exact_fee_total() {
        let stored = add_creator_fee(DEFERRED_FEE_FLAG, 10).unwrap();
        assert!(deferred_fees(stored));
        assert_eq!(creator_fees(stored), 10);
        assert_eq!(creator_fees(add_creator_fee(stored, 15).unwrap()), 25);
    }

    #[test]
    fn repeated_trades_preserve_reserves_and_cap() {
        let mut liquidity = 1_000_000_u64;
        let mut yes = 1_000_000_u64;
        let mut no = 1_000_000_u64;
        for buy_yes in [true, true, false, true, false, false] {
            let input = maximum_trade(liquidity).unwrap();
            let quote = quote_buy(buy_yes, input, liquidity, yes, no).unwrap();
            liquidity = quote.liquidity_after;
            yes = quote.yes_reserve_after;
            no = quote.no_reserve_after;
            assert!(yes > 0 && no > 0);
        }
    }

    #[test]
    fn cap_is_per_transaction_and_recalculates_after_every_buy() {
        let first_cap = maximum_trade(1_000_000).unwrap();
        let first = quote_buy(true, first_cap, 1_000_000, 1_000_000, 1_000_000).unwrap();
        let second_cap = maximum_trade(first.liquidity_after).unwrap();
        assert!(second_cap >= first_cap);
        let second = quote_buy(
            true,
            second_cap,
            first.liquidity_after,
            first.yes_reserve_after,
            first.no_reserve_after,
        )
        .unwrap();
        assert!(second.shares_out > 0);
        assert_eq!(
            minimum_shares_with_one_percent_slippage(first.shares_out).unwrap(),
            first.shares_out * 99 / 100
        );
    }

    #[test]
    fn creator_claim_depends_on_remaining_winning_inventory() {
        assert_eq!(
            creator_pool_claim(MarketOutcome::Yes, 400, 900).unwrap(),
            400
        );
        assert_eq!(
            creator_pool_claim(MarketOutcome::No, 400, 900).unwrap(),
            900
        );
        assert_eq!(
            creator_pool_claim(MarketOutcome::Invalid, 400, 900).unwrap(),
            650
        );
        assert!(creator_pool_claim(MarketOutcome::Unresolved, 400, 900).is_err());
    }

    #[test]
    fn every_trade_conserves_collateral_and_outcome_shares() {
        for buy_yes in [true, false] {
            let yes_before = 800_000_u64;
            let no_before = 1_200_000_u64;
            let quote = quote_buy(buy_yes, 10_000, 1_000_000, yes_before, no_before).unwrap();
            assert_eq!(quote.fee + quote.net_input, quote.gross_input);
            assert_eq!(quote.liquidity_after, 1_000_000 + quote.net_input);
            if buy_yes {
                assert_eq!(
                    quote.yes_reserve_after + quote.shares_out,
                    yes_before + quote.net_input
                );
                assert_eq!(quote.no_reserve_after, no_before + quote.net_input);
            } else {
                assert_eq!(
                    quote.no_reserve_after + quote.shares_out,
                    no_before + quote.net_input
                );
                assert_eq!(quote.yes_reserve_after, yes_before + quote.net_input);
            }
        }
    }
}
