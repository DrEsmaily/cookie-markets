#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx");

const CONFIG_SEED: &[u8] = b"config";
const MARKET_SEED: &[u8] = b"market";
const MAX_FEE_BPS: u16 = 1_000;

#[program]
pub mod cookie_markets {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        fee_recipient: Pubkey,
        resolver: Pubkey,
        fee_bps: u16,
        challenge_period: i64,
    ) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, CookieMarketsError::FeeTooHigh);
        require!(
            challenge_period > 0,
            CookieMarketsError::InvalidChallengePeriod
        );

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.fee_recipient = fee_recipient;
        config.resolver = resolver;
        config.fee_bps = fee_bps;
        config.challenge_period = challenge_period;
        config.bump = ctx.bumps.config;

        emit!(ProtocolInitialized {
            admin: config.admin,
            resolver,
            fee_bps,
        });
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_nonce: u64,
        question_hash: [u8; 32],
        rules_hash: [u8; 32],
        closes_at: i64,
        resolve_after: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        Market::validate_schedule(now, closes_at, resolve_after)?;
        require!(
            question_hash != [0; 32],
            CookieMarketsError::EmptyQuestionHash
        );
        require!(rules_hash != [0; 32], CookieMarketsError::EmptyRulesHash);

        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.nonce = market_nonce;
        market.collateral_mint = ctx.accounts.collateral_mint.key();
        market.resolver = ctx.accounts.config.resolver;
        market.question_hash = question_hash;
        market.rules_hash = rules_hash;
        market.closes_at = closes_at;
        market.resolve_after = resolve_after;
        market.created_at = now;
        market.status = MarketStatus::Draft;
        market.outcome = MarketOutcome::Unresolved;
        market.bump = ctx.bumps.market;

        emit!(MarketCreated {
            market: market.key(),
            creator: market.creator,
            market_nonce,
            closes_at,
            resolve_after,
        });
        Ok(())
    }

    pub fn open_market(ctx: Context<OpenMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Draft,
            CookieMarketsError::InvalidMarketState
        );
        require!(
            Clock::get()?.unix_timestamp < market.closes_at,
            CookieMarketsError::MarketAlreadyClosed
        );

        market.status = MarketStatus::Open;
        emit!(MarketOpened {
            market: market.key()
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(init, payer = admin, space = ProtocolConfig::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_nonce: u64)]
pub struct CreateMarket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = creator,
        space = Market::SPACE,
        seeds = [MARKET_SEED, creator.key().as_ref(), &market_nonce.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: Recorded now and validated by token instructions before custody begins.
    pub collateral_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenMarket<'info> {
    #[account(
        mut,
        has_one = creator,
        seeds = [MARKET_SEED, creator.key().as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    pub creator: Signer<'info>,
}

#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub resolver: Pubkey,
    pub fee_bps: u16,
    pub challenge_period: i64,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 2 + 8 + 1;
}

#[account]
pub struct Market {
    pub creator: Pubkey,
    pub nonce: u64,
    pub collateral_mint: Pubkey,
    pub resolver: Pubkey,
    pub question_hash: [u8; 32],
    pub rules_hash: [u8; 32],
    pub closes_at: i64,
    pub resolve_after: i64,
    pub created_at: i64,
    pub status: MarketStatus,
    pub outcome: MarketOutcome,
    pub bump: u8,
}

impl Market {
    pub const SPACE: usize = 8 + 32 + 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1 + 1;

    fn validate_schedule(now: i64, closes_at: i64, resolve_after: i64) -> Result<()> {
        require!(closes_at > now, CookieMarketsError::CloseTimeNotFuture);
        require!(
            resolve_after >= closes_at,
            CookieMarketsError::ResolutionBeforeClose
        );
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum MarketStatus {
    Draft,
    Open,
    Locked,
    Proposed,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum MarketOutcome {
    Unresolved,
    Yes,
    No,
    Invalid,
}

#[event]
pub struct ProtocolInitialized {
    pub admin: Pubkey,
    pub resolver: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub market_nonce: u64,
    pub closes_at: i64,
    pub resolve_after: i64,
}

#[event]
pub struct MarketOpened {
    pub market: Pubkey,
}

#[error_code]
pub enum CookieMarketsError {
    #[msg("Protocol fee cannot exceed 10%")]
    FeeTooHigh,
    #[msg("Challenge period must be positive")]
    InvalidChallengePeriod,
    #[msg("Market close time must be in the future")]
    CloseTimeNotFuture,
    #[msg("Market resolution cannot begin before close")]
    ResolutionBeforeClose,
    #[msg("Question hash cannot be empty")]
    EmptyQuestionHash,
    #[msg("Rules hash cannot be empty")]
    EmptyRulesHash,
    #[msg("Market is not in the required state")]
    InvalidMarketState,
    #[msg("Market close time has already passed")]
    MarketAlreadyClosed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_schedule() {
        assert!(Market::validate_schedule(100, 200, 200).is_ok());
    }

    #[test]
    fn rejects_close_time_in_the_past() {
        assert!(Market::validate_schedule(100, 100, 200).is_err());
    }

    #[test]
    fn rejects_resolution_before_close() {
        assert!(Market::validate_schedule(100, 300, 299).is_err());
    }
}
