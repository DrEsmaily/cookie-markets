#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, TransferChecked};
mod orders;
pub use orders::*;
mod bids;
pub use bids::*;
mod amm;
pub use amm::*;

declare_id!("BNqof3tMVwNd7rthycJTtXkvbGtopihvL9gpeoSk8WaR");

const CONFIG_SEED: &[u8] = b"config";
const MARKET_SEED: &[u8] = b"market";
const YES_MINT_SEED: &[u8] = b"yes_mint";
const NO_MINT_SEED: &[u8] = b"no_mint";
const VAULT_SEED: &[u8] = b"vault";
const RESOLUTION_SEED: &[u8] = b"resolution";
const POOL_SEED: &[u8] = b"amm_pool";
const POOL_YES_SEED: &[u8] = b"amm_yes";
const POOL_NO_SEED: &[u8] = b"amm_no";
const MAX_FEE_BPS: u16 = 1_000;

#[program]
pub mod cookie_markets {
    use super::*;

    pub fn place_ask(
        ctx: Context<PlaceAsk>,
        nonce: u64,
        side: PositionSide,
        shares: u64,
        price: u64,
        expires_at: i64,
    ) -> Result<()> {
        orders::place(ctx, nonce, side, shares, price, expires_at)
    }

    pub fn fill_ask(ctx: Context<FillAsk>, shares: u64, maximum_debit: u64) -> Result<()> {
        orders::fill(ctx, shares, maximum_debit)
    }

    pub fn cancel_ask(ctx: Context<CancelAsk>) -> Result<()> {
        orders::cancel(ctx)
    }

    pub fn place_bid(
        ctx: Context<PlaceBid>,
        nonce: u64,
        side: PositionSide,
        shares: u64,
        price: u64,
        expires_at: i64,
    ) -> Result<()> {
        bids::execute_place_bid(ctx, nonce, side, shares, price, expires_at)
    }

    pub fn fill_bid(ctx: Context<FillBid>, shares: u64, minimum_proceeds: u64) -> Result<()> {
        bids::execute_fill_bid(ctx, shares, minimum_proceeds)
    }

    pub fn cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
        bids::execute_cancel_bid(ctx)
    }

    pub fn initialize_amm(
        ctx: Context<InitializeAmm>,
        liquidity: u64,
        yes_probability_bps: u16,
    ) -> Result<()> {
        require!(
            ctx.accounts.market.status == MarketStatus::Open,
            CookieMarketsError::InvalidMarketState
        );
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.market.closes_at,
            CookieMarketsError::MarketAlreadyClosed
        );
        require!(
            liquidity >= minimum_initial_liquidity(ctx.accounts.collateral_mint.decimals)?,
            CookieMarketsError::InitialLiquidityTooSmall
        );
        let (yes_reserve, no_reserve) = initial_reserves(liquidity, yes_probability_bps)?;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.creator_collateral.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            liquidity,
            ctx.accounts.collateral_mint.decimals,
        )?;
        let market_key = ctx.accounts.market.key();
        let market = &ctx.accounts.market;
        let nonce_bytes = market.nonce.to_le_bytes();
        let market_seeds: &[&[u8]] = &[
            MARKET_SEED,
            market.creator.as_ref(),
            &nonce_bytes,
            &[market.bump],
        ];
        for (mint, destination) in [
            (&ctx.accounts.yes_mint, &ctx.accounts.pool_yes),
            (&ctx.accounts.no_mint, &ctx.accounts.pool_no),
        ] {
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    MintTo {
                        mint: mint.to_account_info(),
                        to: destination.to_account_info(),
                        authority: market.to_account_info(),
                    },
                    &[market_seeds],
                ),
                liquidity,
            )?;
        }
        let pool = &mut ctx.accounts.pool;
        pool.market = market.key();
        pool.creator = ctx.accounts.creator.key();
        pool.liquidity = liquidity;
        pool.yes_reserve = liquidity;
        pool.no_reserve = liquidity;
        pool.total_creator_fees = DEFERRED_FEE_FLAG;
        pool.settlement_claimed = false;
        pool.bump = ctx.bumps.pool;
        let pool_seeds: &[&[u8]] = &[POOL_SEED, pool.market.as_ref(), &[pool.bump]];
        for (from, to, amount) in [
            (
                &ctx.accounts.pool_yes,
                &ctx.accounts.creator_yes,
                liquidity - yes_reserve,
            ),
            (
                &ctx.accounts.pool_no,
                &ctx.accounts.creator_no,
                liquidity - no_reserve,
            ),
        ] {
            if amount > 0 {
                token::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.key(),
                        TransferChecked {
                            from: from.to_account_info(),
                            mint: if from.mint == ctx.accounts.yes_mint.key() {
                                ctx.accounts.yes_mint.to_account_info()
                            } else {
                                ctx.accounts.no_mint.to_account_info()
                            },
                            to: to.to_account_info(),
                            authority: pool.to_account_info(),
                        },
                        &[pool_seeds],
                    ),
                    amount,
                    ctx.accounts.collateral_mint.decimals,
                )?;
            }
        }
        pool.yes_reserve = yes_reserve;
        pool.no_reserve = no_reserve;
        ctx.accounts.market.outstanding_sets = ctx
            .accounts
            .market
            .outstanding_sets
            .checked_add(liquidity)
            .ok_or(CookieMarketsError::ArithmeticOverflow)?;
        emit!(AmmInitialized {
            market: market_key,
            liquidity,
            yes_probability_bps
        });
        Ok(())
    }

    pub fn buy_from_amm(
        ctx: Context<BuyFromAmm>,
        side: PositionSide,
        shares_out: u64,
        maximum_total_input: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.market.status == MarketStatus::Open,
            CookieMarketsError::InvalidMarketState
        );
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.market.closes_at,
            CookieMarketsError::MarketAlreadyClosed
        );
        let whole_share = 10_u64
            .checked_pow(ctx.accounts.collateral_mint.decimals.into())
            .ok_or(CookieMarketsError::ArithmeticOverflow)?;
        require!(
            shares_out % whole_share == 0,
            CookieMarketsError::WholeSharesRequired
        );
        let quote = quote_whole_shares(
            side == PositionSide::Yes,
            shares_out,
            maximum_total_input,
            ctx.accounts.pool.liquidity,
            ctx.accounts.pool.yes_reserve,
            ctx.accounts.pool.no_reserve,
        )?;
        let fees_deferred = deferred_fees(ctx.accounts.pool.total_creator_fees);
        if !fees_deferred {
            token::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.buyer_collateral.to_account_info(),
                        mint: ctx.accounts.collateral_mint.to_account_info(),
                        to: ctx.accounts.creator_collateral.to_account_info(),
                        authority: ctx.accounts.buyer.to_account_info(),
                    },
                ),
                quote.fee,
                ctx.accounts.collateral_mint.decimals,
            )?;
        }
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.buyer_collateral.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            if fees_deferred {
                quote.gross_input
            } else {
                quote.net_input
            },
            ctx.accounts.collateral_mint.decimals,
        )?;
        let market_key = ctx.accounts.market.key();
        let market = &ctx.accounts.market;
        let nonce_bytes = market.nonce.to_le_bytes();
        let market_seeds: &[&[u8]] = &[
            MARKET_SEED,
            market.creator.as_ref(),
            &nonce_bytes,
            &[market.bump],
        ];
        for (mint, destination) in [
            (&ctx.accounts.yes_mint, &ctx.accounts.pool_yes),
            (&ctx.accounts.no_mint, &ctx.accounts.pool_no),
        ] {
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    MintTo {
                        mint: mint.to_account_info(),
                        to: destination.to_account_info(),
                        authority: market.to_account_info(),
                    },
                    &[market_seeds],
                ),
                quote.net_input,
            )?;
        }
        let pool = &ctx.accounts.pool;
        let pool_seeds: &[&[u8]] = &[POOL_SEED, pool.market.as_ref(), &[pool.bump]];
        let (mint, source, destination) = match side {
            PositionSide::Yes => (
                &ctx.accounts.yes_mint,
                &ctx.accounts.pool_yes,
                &ctx.accounts.buyer_yes,
            ),
            PositionSide::No => (
                &ctx.accounts.no_mint,
                &ctx.accounts.pool_no,
                &ctx.accounts.buyer_no,
            ),
        };
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: source.to_account_info(),
                    mint: mint.to_account_info(),
                    to: destination.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            quote.shares_out,
            ctx.accounts.collateral_mint.decimals,
        )?;
        let pool = &mut ctx.accounts.pool;
        pool.liquidity = quote.liquidity_after;
        pool.yes_reserve = quote.yes_reserve_after;
        pool.no_reserve = quote.no_reserve_after;
        pool.total_creator_fees = add_creator_fee(pool.total_creator_fees, quote.fee)?;
        ctx.accounts.market.outstanding_sets = ctx
            .accounts
            .market
            .outstanding_sets
            .checked_add(quote.net_input)
            .ok_or(CookieMarketsError::ArithmeticOverflow)?;
        emit!(AmmTrade {
            market: market_key,
            buyer: ctx.accounts.buyer.key(),
            side,
            gross_input: quote.gross_input,
            fee: quote.fee,
            shares_out: quote.shares_out,
            yes_probability_bps: yes_probability_bps(pool.yes_reserve, pool.no_reserve)?
        });
        Ok(())
    }

    pub fn claim_amm_settlement(ctx: Context<ClaimAmmSettlement>) -> Result<()> {
        require!(
            ctx.accounts.market.status == MarketStatus::Resolved,
            CookieMarketsError::InvalidMarketState
        );
        require!(
            !ctx.accounts.pool.settlement_claimed,
            CookieMarketsError::PoolAlreadyClaimed
        );
        let payout = creator_pool_claim(
            ctx.accounts.market.outcome,
            ctx.accounts.pool.yes_reserve,
            ctx.accounts.pool.no_reserve,
        )?;
        let pool = &ctx.accounts.pool;
        let pool_seeds: &[&[u8]] = &[POOL_SEED, pool.market.as_ref(), &[pool.bump]];
        let burns = match ctx.accounts.market.outcome {
            MarketOutcome::Yes => [
                (
                    ctx.accounts.yes_mint.to_account_info(),
                    ctx.accounts.pool_yes.to_account_info(),
                    ctx.accounts.pool.yes_reserve,
                ),
                (
                    ctx.accounts.no_mint.to_account_info(),
                    ctx.accounts.pool_no.to_account_info(),
                    0,
                ),
            ],
            MarketOutcome::No => [
                (
                    ctx.accounts.no_mint.to_account_info(),
                    ctx.accounts.pool_no.to_account_info(),
                    ctx.accounts.pool.no_reserve,
                ),
                (
                    ctx.accounts.yes_mint.to_account_info(),
                    ctx.accounts.pool_yes.to_account_info(),
                    0,
                ),
            ],
            MarketOutcome::Invalid => [
                (
                    ctx.accounts.yes_mint.to_account_info(),
                    ctx.accounts.pool_yes.to_account_info(),
                    ctx.accounts.pool.yes_reserve,
                ),
                (
                    ctx.accounts.no_mint.to_account_info(),
                    ctx.accounts.pool_no.to_account_info(),
                    ctx.accounts.pool.no_reserve,
                ),
            ],
            MarketOutcome::Unresolved => return err!(CookieMarketsError::InvalidMarketState),
        };
        for (mint, from, amount) in burns {
            if amount > 0 {
                token::burn(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.key(),
                        Burn {
                            mint,
                            from,
                            authority: pool.to_account_info(),
                        },
                        &[pool_seeds],
                    ),
                    amount,
                )?;
            }
        }
        let market = &ctx.accounts.market;
        let nonce_bytes = market.nonce.to_le_bytes();
        let market_seeds: &[&[u8]] = &[
            MARKET_SEED,
            market.creator.as_ref(),
            &nonce_bytes,
            &[market.bump],
        ];
        let total_payout = if deferred_fees(ctx.accounts.pool.total_creator_fees) {
            payout
                .checked_add(creator_fees(ctx.accounts.pool.total_creator_fees))
                .ok_or(CookieMarketsError::ArithmeticOverflow)?
        } else {
            payout
        };
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.creator_collateral.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[market_seeds],
            ),
            total_payout,
            ctx.accounts.collateral_mint.decimals,
        )?;
        ctx.accounts.market.outstanding_sets = ctx
            .accounts
            .market
            .outstanding_sets
            .checked_sub(payout)
            .ok_or(CookieMarketsError::InsufficientOutstandingSets)?;
        ctx.accounts.pool.settlement_claimed = true;
        emit!(AmmSettlementClaimed {
            market: ctx.accounts.market.key(),
            creator: ctx.accounts.creator.key(),
            payout: total_payout
        });
        Ok(())
    }

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        fee_recipient: Pubkey,
        resolver: Pubkey,
        fee_bps: u16,
        challenge_period: i64,
    ) -> Result<()> {
        ProtocolConfig::validate_initialization(
            fee_recipient,
            resolver,
            fee_bps,
            challenge_period,
        )?;

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.fee_recipient = fee_recipient;
        config.resolver = resolver;
        config.collateral_mint = ctx.accounts.collateral_mint.key();
        config.fee_bps = fee_bps;
        config.challenge_period = challenge_period;
        config.bump = ctx.bumps.config;

        emit!(ProtocolInitialized {
            admin: config.admin,
            resolver,
            collateral_mint: config.collateral_mint,
            fee_bps,
        });
        Ok(())
    }

    pub fn update_protocol(
        ctx: Context<UpdateProtocol>,
        fee_recipient: Pubkey,
        resolver: Pubkey,
        fee_bps: u16,
        challenge_period: i64,
    ) -> Result<()> {
        ProtocolConfig::validate_initialization(
            fee_recipient,
            resolver,
            fee_bps,
            challenge_period,
        )?;
        let config = &mut ctx.accounts.config;
        config.fee_recipient = fee_recipient;
        config.resolver = resolver;
        config.fee_bps = fee_bps;
        config.challenge_period = challenge_period;
        emit!(ProtocolInitialized {
            admin: config.admin,
            resolver,
            collateral_mint: config.collateral_mint,
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
        market.yes_mint = ctx.accounts.yes_mint.key();
        market.no_mint = ctx.accounts.no_mint.key();
        market.vault = ctx.accounts.vault.key();
        market.resolver = ctx.accounts.config.resolver;
        market.question_hash = question_hash;
        market.rules_hash = rules_hash;
        market.closes_at = closes_at;
        market.resolve_after = resolve_after;
        market.created_at = now;
        market.status = MarketStatus::Draft;
        market.outcome = MarketOutcome::Unresolved;
        market.outstanding_sets = 0;
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

    pub fn split_collateral(ctx: Context<SplitCollateral>, amount: u64) -> Result<()> {
        require!(amount > 0, CookieMarketsError::ZeroAmount);
        let market = &ctx.accounts.market;
        require!(
            market.status == MarketStatus::Open,
            CookieMarketsError::InvalidMarketState
        );
        require!(
            Clock::get()?.unix_timestamp < market.closes_at,
            CookieMarketsError::MarketAlreadyClosed
        );

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_collateral.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.collateral_mint.decimals,
        )?;

        let nonce_bytes = market.nonce.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[
            MARKET_SEED,
            market.creator.as_ref(),
            &nonce_bytes,
            &[market.bump],
        ];
        let signer = &[signer_seeds];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.yes_mint.to_account_info(),
                    to: ctx.accounts.user_yes.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.no_mint.to_account_info(),
                    to: ctx.accounts.user_no.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        let market = &mut ctx.accounts.market;
        market.outstanding_sets = market
            .outstanding_sets
            .checked_add(amount)
            .ok_or(CookieMarketsError::ArithmeticOverflow)?;

        emit!(CollateralSplit {
            market: market.key(),
            user: ctx.accounts.user.key(),
            amount,
        });
        Ok(())
    }

    pub fn merge_positions(ctx: Context<MergePositions>, amount: u64) -> Result<()> {
        require!(amount > 0, CookieMarketsError::ZeroAmount);
        require!(
            matches!(
                ctx.accounts.market.status,
                MarketStatus::Open | MarketStatus::Locked | MarketStatus::Proposed
            ),
            CookieMarketsError::InvalidMarketState
        );

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.yes_mint.to_account_info(),
                    from: ctx.accounts.user_yes.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.no_mint.to_account_info(),
                    from: ctx.accounts.user_no.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let market = &ctx.accounts.market;
        let nonce_bytes = market.nonce.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[
            MARKET_SEED,
            market.creator.as_ref(),
            &nonce_bytes,
            &[market.bump],
        ];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.user_collateral.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.collateral_mint.decimals,
        )?;

        let market = &mut ctx.accounts.market;
        market.outstanding_sets = market
            .outstanding_sets
            .checked_sub(amount)
            .ok_or(CookieMarketsError::InsufficientOutstandingSets)?;

        emit!(PositionsMerged {
            market: market.key(),
            user: ctx.accounts.user.key(),
            amount,
        });
        Ok(())
    }

    pub fn lock_market(ctx: Context<LockMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Open,
            CookieMarketsError::InvalidMarketState
        );
        require!(
            Clock::get()?.unix_timestamp >= market.closes_at,
            CookieMarketsError::MarketStillOpen
        );

        market.status = MarketStatus::Locked;
        emit!(MarketLocked {
            market: market.key()
        });
        Ok(())
    }

    pub fn propose_resolution(
        ctx: Context<ProposeResolution>,
        outcome: MarketOutcome,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        require!(
            outcome.is_final(),
            CookieMarketsError::InvalidResolutionOutcome
        );
        require!(
            evidence_hash != [0; 32],
            CookieMarketsError::EmptyEvidenceHash
        );

        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Locked,
            CookieMarketsError::InvalidMarketState
        );
        require!(
            now >= market.resolve_after,
            CookieMarketsError::ResolutionTooEarly
        );

        let proposal = &mut ctx.accounts.resolution;
        proposal.market = market.key();
        proposal.proposed_by = ctx.accounts.resolver.key();
        proposal.outcome = outcome;
        proposal.evidence_hash = evidence_hash;
        proposal.proposed_at = now;
        proposal.challenge_deadline = now
            .checked_add(ctx.accounts.config.challenge_period)
            .ok_or(CookieMarketsError::ArithmeticOverflow)?;
        proposal.challenged = false;
        proposal.bump = ctx.bumps.resolution;
        market.status = MarketStatus::Proposed;

        emit!(ResolutionProposed {
            market: market.key(),
            outcome,
            challenge_deadline: proposal.challenge_deadline,
        });
        Ok(())
    }

    pub fn challenge_resolution(ctx: Context<ChallengeResolution>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.resolution;
        require!(
            now < proposal.challenge_deadline,
            CookieMarketsError::ChallengeWindowClosed
        );
        require!(!proposal.challenged, CookieMarketsError::AlreadyChallenged);

        proposal.challenged = true;
        emit!(ResolutionChallenged {
            market: ctx.accounts.market.key(),
            challenger: ctx.accounts.challenger.key(),
        });
        Ok(())
    }

    pub fn resolve_challenge(
        ctx: Context<ResolveChallenge>,
        outcome: MarketOutcome,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        require!(
            outcome.is_final(),
            CookieMarketsError::InvalidResolutionOutcome
        );
        require!(
            evidence_hash != [0; 32],
            CookieMarketsError::EmptyEvidenceHash
        );
        require!(
            ctx.accounts.resolution.challenged,
            CookieMarketsError::ResolutionNotChallenged
        );

        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.resolution;
        proposal.outcome = outcome;
        proposal.evidence_hash = evidence_hash;
        proposal.proposed_by = ctx.accounts.resolver.key();
        proposal.proposed_at = now;
        proposal.challenge_deadline = now
            .checked_add(ctx.accounts.config.challenge_period)
            .ok_or(CookieMarketsError::ArithmeticOverflow)?;
        proposal.challenged = false;

        emit!(ResolutionProposed {
            market: ctx.accounts.market.key(),
            outcome,
            challenge_deadline: proposal.challenge_deadline,
        });
        Ok(())
    }

    pub fn finalize_resolution(ctx: Context<FinalizeResolution>) -> Result<()> {
        let proposal = &ctx.accounts.resolution;
        require!(
            !proposal.challenged,
            CookieMarketsError::ResolutionChallenged
        );
        require!(
            Clock::get()?.unix_timestamp >= proposal.challenge_deadline,
            CookieMarketsError::ChallengeWindowOpen
        );

        let market = &mut ctx.accounts.market;
        market.outcome = proposal.outcome;
        market.status = MarketStatus::Resolved;
        emit!(ResolutionFinalized {
            market: market.key(),
            outcome: market.outcome,
        });
        Ok(())
    }

    pub fn redeem(ctx: Context<Redeem>, side: PositionSide, amount: u64) -> Result<()> {
        require!(amount > 0, CookieMarketsError::ZeroAmount);
        let market = &ctx.accounts.market;
        require!(
            market.status == MarketStatus::Resolved,
            CookieMarketsError::InvalidMarketState
        );

        let payout = market.payout_for(side, amount)?;
        let (mint, position) = match side {
            PositionSide::Yes => (
                ctx.accounts.yes_mint.to_account_info(),
                ctx.accounts.user_yes.to_account_info(),
            ),
            PositionSide::No => (
                ctx.accounts.no_mint.to_account_info(),
                ctx.accounts.user_no.to_account_info(),
            ),
        };

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint,
                    from: position,
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let nonce_bytes = market.nonce.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[
            MARKET_SEED,
            market.creator.as_ref(),
            &nonce_bytes,
            &[market.bump],
        ];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.user_collateral.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[signer_seeds],
            ),
            payout,
            ctx.accounts.collateral_mint.decimals,
        )?;

        let market = &mut ctx.accounts.market;
        market.outstanding_sets = market
            .outstanding_sets
            .checked_sub(payout)
            .ok_or(CookieMarketsError::InsufficientOutstandingSets)?;

        emit!(PositionRedeemed {
            market: market.key(),
            user: ctx.accounts.user.key(),
            side,
            shares_burned: amount,
            collateral_paid: payout,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(init, payer = admin, space = ProtocolConfig::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, ProtocolConfig>,
    pub collateral_mint: Account<'info, Mint>,
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
    #[account(address = config.collateral_mint @ CookieMarketsError::UnsupportedCollateral)]
    pub collateral_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        seeds = [YES_MINT_SEED, market.key().as_ref()],
        bump,
        mint::decimals = collateral_mint.decimals,
        mint::authority = market
    )]
    pub yes_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        seeds = [NO_MINT_SEED, market.key().as_ref()],
        bump,
        mint::decimals = collateral_mint.decimals,
        mint::authority = market
    )]
    pub no_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = market
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
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

#[derive(Accounts)]
pub struct UpdateProtocol<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, ProtocolConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SplitCollateral<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Account<'info, Mint>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Account<'info, Mint>,
    #[account(mut, address = market.vault, token::mint = collateral_mint, token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = collateral_mint, token::authority = user)]
    pub user_collateral: Account<'info, TokenAccount>,
    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MergePositions<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Account<'info, Mint>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Account<'info, Mint>,
    #[account(mut, address = market.vault, token::mint = collateral_mint, token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = collateral_mint, token::authority = user)]
    pub user_collateral: Account<'info, TokenAccount>,
    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitializeAmm<'info> {
    #[account(mut, has_one = creator)]
    pub market: Box<Account<'info, Market>>,
    #[account(init, payer = creator, space = AmmPool::SPACE, seeds = [POOL_SEED, market.key().as_ref()], bump)]
    pub pool: Box<Account<'info, AmmPool>>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.vault, token::mint = collateral_mint, token::authority = market)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = creator, seeds = [POOL_YES_SEED, market.key().as_ref()], bump, token::mint = yes_mint, token::authority = pool)]
    pub pool_yes: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = creator, seeds = [POOL_NO_SEED, market.key().as_ref()], bump, token::mint = no_mint, token::authority = pool)]
    pub pool_no: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = creator)]
    pub creator_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = yes_mint, token::authority = creator)]
    pub creator_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = no_mint, token::authority = creator)]
    pub creator_no: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyFromAmm<'info> {
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [POOL_SEED, market.key().as_ref()], bump = pool.bump, has_one = market, has_one = creator)]
    pub pool: Box<Account<'info, AmmPool>>,
    /// CHECK: Bound to the pool and creator collateral token authority.
    pub creator: UncheckedAccount<'info>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.vault, token::mint = collateral_mint, token::authority = market)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_YES_SEED, market.key().as_ref()], bump, token::mint = yes_mint, token::authority = pool)]
    pub pool_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_NO_SEED, market.key().as_ref()], bump, token::mint = no_mint, token::authority = pool)]
    pub pool_no: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = creator)]
    pub creator_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = buyer)]
    pub buyer_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = yes_mint, token::authority = buyer)]
    pub buyer_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = no_mint, token::authority = buyer)]
    pub buyer_no: Box<Account<'info, TokenAccount>>,
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimAmmSettlement<'info> {
    #[account(mut, has_one = creator)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [POOL_SEED, market.key().as_ref()], bump = pool.bump, has_one = market, has_one = creator)]
    pub pool: Box<Account<'info, AmmPool>>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = market.vault, token::mint = collateral_mint, token::authority = market)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_YES_SEED, market.key().as_ref()], bump, token::mint = yes_mint, token::authority = pool)]
    pub pool_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_NO_SEED, market.key().as_ref()], bump, token::mint = no_mint, token::authority = pool)]
    pub pool_no: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = creator)]
    pub creator_collateral: Box<Account<'info, TokenAccount>>,
    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct LockMarket<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ProposeResolution<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = resolver)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        has_one = resolver,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = resolver,
        space = ResolutionProposal::SPACE,
        seeds = [RESOLUTION_SEED, market.key().as_ref()],
        bump
    )]
    pub resolution: Account<'info, ResolutionProposal>,
    #[account(mut)]
    pub resolver: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ChallengeResolution<'info> {
    #[account(
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Proposed @ CookieMarketsError::InvalidMarketState
    )]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [RESOLUTION_SEED, market.key().as_ref()], bump = resolution.bump)]
    pub resolution: Account<'info, ResolutionProposal>,
    pub challenger: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveChallenge<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = resolver)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        has_one = resolver,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Proposed @ CookieMarketsError::InvalidMarketState
    )]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [RESOLUTION_SEED, market.key().as_ref()], bump = resolution.bump)]
    pub resolution: Account<'info, ResolutionProposal>,
    pub resolver: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeResolution<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Proposed @ CookieMarketsError::InvalidMarketState
    )]
    pub market: Account<'info, Market>,
    #[account(seeds = [RESOLUTION_SEED, market.key().as_ref()], bump = resolution.bump, has_one = market)]
    pub resolution: Account<'info, ResolutionProposal>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Account<'info, Mint>,
    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut, address = market.no_mint)]
    pub no_mint: Account<'info, Mint>,
    #[account(mut, address = market.vault, token::mint = collateral_mint, token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = collateral_mint, token::authority = user)]
    pub user_collateral: Account<'info, TokenAccount>,
    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub resolver: Pubkey,
    pub collateral_mint: Pubkey,
    pub fee_bps: u16,
    pub challenge_period: i64,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 2 + 8 + 1;

    fn validate_initialization(
        fee_recipient: Pubkey,
        resolver: Pubkey,
        fee_bps: u16,
        challenge_period: i64,
    ) -> Result<()> {
        require!(
            fee_recipient != Pubkey::default(),
            CookieMarketsError::InvalidFeeRecipient
        );
        require!(
            resolver != Pubkey::default(),
            CookieMarketsError::InvalidResolver
        );
        require!(fee_bps <= MAX_FEE_BPS, CookieMarketsError::FeeTooHigh);
        require!(
            challenge_period >= 0,
            CookieMarketsError::InvalidChallengePeriod
        );
        Ok(())
    }
}

#[account]
pub struct Market {
    pub creator: Pubkey,
    pub nonce: u64,
    pub collateral_mint: Pubkey,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub vault: Pubkey,
    pub resolver: Pubkey,
    pub question_hash: [u8; 32],
    pub rules_hash: [u8; 32],
    pub closes_at: i64,
    pub resolve_after: i64,
    pub created_at: i64,
    pub status: MarketStatus,
    pub outcome: MarketOutcome,
    pub outstanding_sets: u64,
    pub bump: u8,
}

#[account]
pub struct AmmPool {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub liquidity: u64,
    pub yes_reserve: u64,
    pub no_reserve: u64,
    pub total_creator_fees: u64,
    pub settlement_claimed: bool,
    pub bump: u8,
}

impl AmmPool {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

impl Market {
    pub const SPACE: usize =
        8 + 32 + 8 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1 + 8 + 1;

    fn validate_schedule(now: i64, closes_at: i64, resolve_after: i64) -> Result<()> {
        require!(closes_at > now, CookieMarketsError::CloseTimeNotFuture);
        require!(
            resolve_after >= closes_at,
            CookieMarketsError::ResolutionBeforeClose
        );
        Ok(())
    }

    fn payout_for(&self, side: PositionSide, amount: u64) -> Result<u64> {
        let payout = match (self.outcome, side) {
            (MarketOutcome::Yes, PositionSide::Yes) | (MarketOutcome::No, PositionSide::No) => {
                amount
            }
            (MarketOutcome::Invalid, _) => {
                require!(amount % 2 == 0, CookieMarketsError::InvalidRedemptionAmount);
                amount / 2
            }
            _ => return err!(CookieMarketsError::LosingPosition),
        };
        require!(payout > 0, CookieMarketsError::PayoutRoundsToZero);
        Ok(payout)
    }
}

#[account]
pub struct ResolutionProposal {
    pub market: Pubkey,
    pub proposed_by: Pubkey,
    pub outcome: MarketOutcome,
    pub evidence_hash: [u8; 32],
    pub proposed_at: i64,
    pub challenge_deadline: i64,
    pub challenged: bool,
    pub bump: u8,
}

impl ResolutionProposal {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 32 + 8 + 8 + 1 + 1;
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

impl MarketOutcome {
    fn is_final(self) -> bool {
        matches!(self, Self::Yes | Self::No | Self::Invalid)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum PositionSide {
    Yes,
    No,
}

#[event]
pub struct ProtocolInitialized {
    pub admin: Pubkey,
    pub resolver: Pubkey,
    pub collateral_mint: Pubkey,
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

#[event]
pub struct CollateralSplit {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PositionsMerged {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct MarketLocked {
    pub market: Pubkey,
}

#[event]
pub struct ResolutionProposed {
    pub market: Pubkey,
    pub outcome: MarketOutcome,
    pub challenge_deadline: i64,
}

#[event]
pub struct ResolutionChallenged {
    pub market: Pubkey,
    pub challenger: Pubkey,
}

#[event]
pub struct ResolutionFinalized {
    pub market: Pubkey,
    pub outcome: MarketOutcome,
}

#[event]
pub struct PositionRedeemed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub side: PositionSide,
    pub shares_burned: u64,
    pub collateral_paid: u64,
}

#[event]
pub struct AmmInitialized {
    pub market: Pubkey,
    pub liquidity: u64,
    pub yes_probability_bps: u16,
}

#[event]
pub struct AmmTrade {
    pub market: Pubkey,
    pub buyer: Pubkey,
    pub side: PositionSide,
    pub gross_input: u64,
    pub fee: u64,
    pub shares_out: u64,
    pub yes_probability_bps: u16,
}

#[event]
pub struct AmmSettlementClaimed {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub payout: u64,
}

#[error_code]
pub enum CookieMarketsError {
    #[msg("Fee recipient cannot be the default public key")]
    InvalidFeeRecipient,
    #[msg("Resolver cannot be the default public key")]
    InvalidResolver,
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
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Amount exceeds outstanding complete sets")]
    InsufficientOutstandingSets,
    #[msg("Market has not reached its close time")]
    MarketStillOpen,
    #[msg("Resolution outcome must be Yes, No, or Invalid")]
    InvalidResolutionOutcome,
    #[msg("Evidence hash cannot be empty")]
    EmptyEvidenceHash,
    #[msg("Resolution cannot be proposed yet")]
    ResolutionTooEarly,
    #[msg("Challenge window has closed")]
    ChallengeWindowClosed,
    #[msg("Resolution has already been challenged")]
    AlreadyChallenged,
    #[msg("Resolution was not challenged")]
    ResolutionNotChallenged,
    #[msg("Challenged resolution must be reviewed")]
    ResolutionChallenged,
    #[msg("Challenge window is still open")]
    ChallengeWindowOpen,
    #[msg("This position is not eligible for redemption")]
    LosingPosition,
    #[msg("Redemption amount is too small")]
    PayoutRoundsToZero,
    #[msg("Collateral mint is not approved by the protocol")]
    UnsupportedCollateral,
    #[msg("Invalid-market redemption requires an even number of share base units")]
    InvalidRedemptionAmount,
    #[msg("Starting YES probability must be between 0% and 100%")]
    InvalidStartingProbability,
    #[msg("The AMM pool is too small")]
    PoolTooSmall,
    #[msg("Trade exceeds 1% of current pool liquidity")]
    TradeExceedsPoolCap,
    #[msg("Trade is too small after the creator fee")]
    TradeTooSmall,
    #[msg("AMM purchases must use whole shares")]
    WholeSharesRequired,
    #[msg("AMM reserve invariant would decrease")]
    PoolInvariantViolation,
    #[msg("Initial AMM liquidity must be at least 100 COOK")]
    InitialLiquidityTooSmall,
    #[msg("Submitted slippage tolerance exceeds 1%")]
    SlippageTooHigh,
    #[msg("Trade output is below the submitted minimum")]
    SlippageExceeded,
    #[msg("The creator has already claimed this pool settlement")]
    PoolAlreadyClaimed,
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

    #[test]
    fn rejects_unusable_protocol_configuration() {
        let valid = Pubkey::new_unique();
        assert!(ProtocolConfig::validate_initialization(valid, valid, 1_000, 1).is_ok());
        assert!(ProtocolConfig::validate_initialization(Pubkey::default(), valid, 0, 1).is_err());
        assert!(ProtocolConfig::validate_initialization(valid, Pubkey::default(), 0, 1).is_err());
        assert!(ProtocolConfig::validate_initialization(valid, valid, 1_001, 1).is_err());
        assert!(ProtocolConfig::validate_initialization(valid, valid, 0, 0).is_ok());
        assert!(ProtocolConfig::validate_initialization(valid, valid, 0, -1).is_err());
    }

    #[test]
    fn pays_winning_position_in_full() {
        let market = market_with_outcome(MarketOutcome::Yes);
        assert_eq!(market.payout_for(PositionSide::Yes, 25).unwrap(), 25);
        assert!(market.payout_for(PositionSide::No, 25).is_err());
    }

    #[test]
    fn pays_half_for_invalid_market() {
        let market = market_with_outcome(MarketOutcome::Invalid);
        assert_eq!(market.payout_for(PositionSide::Yes, 20).unwrap(), 10);
        assert_eq!(market.payout_for(PositionSide::No, 20).unwrap(), 10);
    }

    #[test]
    fn rejects_fractional_invalid_payouts() {
        let market = market_with_outcome(MarketOutcome::Invalid);
        for amount in [1, 3, 25, u64::MAX] {
            assert!(market.payout_for(PositionSide::Yes, amount).is_err());
            assert!(market.payout_for(PositionSide::No, amount).is_err());
        }
    }

    #[test]
    fn rejects_zero_redemption() {
        for outcome in [
            MarketOutcome::Yes,
            MarketOutcome::No,
            MarketOutcome::Invalid,
        ] {
            let market = market_with_outcome(outcome);
            assert!(market.payout_for(PositionSide::Yes, 0).is_err());
            assert!(market.payout_for(PositionSide::No, 0).is_err());
        }
    }

    #[test]
    fn pays_no_winners_and_rejects_unresolved_positions() {
        let market = market_with_outcome(MarketOutcome::No);
        assert_eq!(
            market.payout_for(PositionSide::No, u64::MAX).unwrap(),
            u64::MAX
        );
        assert!(market.payout_for(PositionSide::Yes, 20).is_err());
        let unresolved = market_with_outcome(MarketOutcome::Unresolved);
        assert!(unresolved.payout_for(PositionSide::Yes, 20).is_err());
        assert!(unresolved.payout_for(PositionSide::No, 20).is_err());
    }

    #[test]
    fn market_serialization_matches_discovery_layout() {
        let market = market_with_outcome(MarketOutcome::Yes);
        let mut data = Vec::new();
        market.try_serialize(&mut data).unwrap();
        assert_eq!(data.len(), 307);
        assert_eq!(Market::SPACE, data.len());
        assert_eq!(data[296], 4);
        assert_eq!(data[297], 1);
    }

    fn market_with_outcome(outcome: MarketOutcome) -> Market {
        Market {
            creator: Pubkey::default(),
            nonce: 0,
            collateral_mint: Pubkey::default(),
            yes_mint: Pubkey::default(),
            no_mint: Pubkey::default(),
            vault: Pubkey::default(),
            resolver: Pubkey::default(),
            question_hash: [1; 32],
            rules_hash: [1; 32],
            closes_at: 0,
            resolve_after: 0,
            created_at: 0,
            status: MarketStatus::Resolved,
            outcome,
            outstanding_sets: 0,
            bump: 0,
        }
    }
}
