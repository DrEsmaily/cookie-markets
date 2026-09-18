use super::*;

const BID_SEED: &[u8] = b"bid";
const BID_ESCROW_SEED: &[u8] = b"bid_escrow";

pub fn execute_place_bid(
    ctx: Context<PlaceBid>,
    nonce: u64,
    side: PositionSide,
    shares: u64,
    price: u64,
    expires_at: i64,
) -> Result<()> {
    let market = &ctx.accounts.market;
    let now = Clock::get()?.unix_timestamp;
    require!(
        market.status == MarketStatus::Open && now < market.closes_at,
        OrderError::TradingClosed
    );
    require!(
        expires_at > now && expires_at <= market.closes_at,
        OrderError::InvalidExpiry
    );
    let expected_mint = match side {
        PositionSide::Yes => market.yes_mint,
        PositionSide::No => market.no_mint,
    };
    require_keys_eq!(
        ctx.accounts.share_mint.key(),
        expected_mint,
        OrderError::WrongMint
    );
    require!(
        ctx.accounts.share_mint.decimals == ctx.accounts.collateral_mint.decimals,
        OrderError::WrongMint
    );
    let (_, _, deposit) =
        orders::quote_order_fill(shares, 0, shares, price, ctx.accounts.config.fee_bps)?;
    let order = &mut ctx.accounts.order;
    order.market = market.key();
    order.maker = ctx.accounts.maker.key();
    order.share_mint = expected_mint;
    order.collateral_mint = market.collateral_mint;
    order.fee_recipient = ctx.accounts.config.fee_recipient;
    order.nonce = nonce;
    order.total_shares = shares;
    order.filled_shares = 0;
    order.price = price;
    order.expires_at = expires_at;
    order.fee_bps = ctx.accounts.config.fee_bps;
    order.cancelled = false;
    order.bump = ctx.bumps.order;
    order.escrow_bump = ctx.bumps.escrow;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.maker_collateral.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
            },
        ),
        deposit,
        ctx.accounts.collateral_mint.decimals,
    )
}

pub fn execute_fill_bid(ctx: Context<FillBid>, shares: u64, minimum_proceeds: u64) -> Result<()> {
    let market = &ctx.accounts.market;
    let order = &ctx.accounts.order;
    let now = Clock::get()?.unix_timestamp;
    require!(
        market.status == MarketStatus::Open && now < market.closes_at && now < order.expires_at,
        OrderError::TradingClosed
    );
    require!(!order.cancelled, OrderError::Cancelled);
    require!(
        ctx.accounts.taker.key() != order.maker,
        OrderError::SelfTrade
    );
    let (collateral, fee, _) = orders::quote_order_fill(
        order.total_shares,
        order.filled_shares,
        shares,
        order.price,
        order.fee_bps,
    )?;
    require!(collateral >= minimum_proceeds, OrderError::Slippage);
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.taker_shares.to_account_info(),
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.maker_shares.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
            },
        ),
        shares,
        ctx.accounts.share_mint.decimals,
    )?;
    let nonce = order.nonce.to_le_bytes();
    let bump = [order.bump];
    let seeds = [
        BID_SEED,
        order.market.as_ref(),
        order.maker.as_ref(),
        nonce.as_ref(),
        bump.as_ref(),
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.escrow.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.taker_collateral.to_account_info(),
                authority: order.to_account_info(),
            },
            &[&seeds],
        ),
        collateral,
        ctx.accounts.collateral_mint.decimals,
    )?;
    if fee > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.fee_collateral.to_account_info(),
                    authority: order.to_account_info(),
                },
                &[&seeds],
            ),
            fee,
            ctx.accounts.collateral_mint.decimals,
        )?;
    }
    ctx.accounts.order.filled_shares = order
        .filled_shares
        .checked_add(shares)
        .ok_or(OrderError::InvalidAmount)?;
    Ok(())
}

pub fn execute_cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
    let order = &ctx.accounts.order;
    require!(!order.cancelled, OrderError::Cancelled);
    let nonce = order.nonce.to_le_bytes();
    let bump = [order.bump];
    let seeds = [
        BID_SEED,
        order.market.as_ref(),
        order.maker.as_ref(),
        nonce.as_ref(),
        bump.as_ref(),
    ];
    if ctx.accounts.escrow.amount > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.maker_collateral.to_account_info(),
                    authority: order.to_account_info(),
                },
                &[&seeds],
            ),
            ctx.accounts.escrow.amount,
            ctx.accounts.collateral_mint.decimals,
        )?;
    }
    ctx.accounts.order.cancelled = true;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct PlaceBid<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()], bump = market.bump, constraint = market.collateral_mint == config.collateral_mint)]
    pub market: Box<Account<'info, Market>>,
    #[account(init, payer = maker, space = BidOrder::SPACE, seeds = [BID_SEED, market.key().as_ref(), maker.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub order: Box<Account<'info, BidOrder>>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = maker, seeds = [BID_ESCROW_SEED, order.key().as_ref()], bump, token::mint = collateral_mint, token::authority = order)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = maker)]
    pub maker_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub maker: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FillBid<'info> {
    #[account(seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, has_one = market, has_one = share_mint, has_one = collateral_mint, seeds = [BID_SEED, market.key().as_ref(), order.maker.as_ref(), &order.nonce.to_le_bytes()], bump = order.bump)]
    pub order: Box<Account<'info, BidOrder>>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BID_ESCROW_SEED, order.key().as_ref()], bump = order.escrow_bump, token::mint = collateral_mint, token::authority = order)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = share_mint, token::authority = taker)]
    pub taker_shares: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = share_mint, constraint = maker_shares.owner == order.maker)]
    pub maker_shares: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = taker)]
    pub taker_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, dup, token::mint = collateral_mint, constraint = fee_collateral.owner == order.fee_recipient)]
    pub fee_collateral: Box<Account<'info, TokenAccount>>,
    pub taker: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelBid<'info> {
    #[account(mut, has_one = maker, has_one = collateral_mint, seeds = [BID_SEED, order.market.as_ref(), maker.key().as_ref(), &order.nonce.to_le_bytes()], bump = order.bump)]
    pub order: Box<Account<'info, BidOrder>>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BID_ESCROW_SEED, order.key().as_ref()], bump = order.escrow_bump, token::mint = collateral_mint, token::authority = order)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = maker)]
    pub maker_collateral: Box<Account<'info, TokenAccount>>,
    pub maker: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct BidOrder {
    pub market: Pubkey,
    pub maker: Pubkey,
    pub share_mint: Pubkey,
    pub collateral_mint: Pubkey,
    pub fee_recipient: Pubkey,
    pub nonce: u64,
    pub total_shares: u64,
    pub filled_shares: u64,
    pub price: u64,
    pub expires_at: i64,
    pub fee_bps: u16,
    pub cancelled: bool,
    pub bump: u8,
    pub escrow_bump: u8,
}

impl BidOrder {
    pub const SPACE: usize = 8 + 32 * 5 + 8 * 5 + 2 + 3;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bid_budget_covers_partial_fills_and_matches_layout() {
        assert!(std::mem::size_of::<FillBid>() < 1024);
        let mut order = BidOrder {
            market: Pubkey::default(),
            maker: Pubkey::default(),
            share_mint: Pubkey::default(),
            collateral_mint: Pubkey::default(),
            fee_recipient: Pubkey::default(),
            nonce: u64::MAX,
            total_shares: 1000,
            filled_shares: 0,
            price: 333333,
            expires_at: 1,
            fee_bps: 30,
            cancelled: false,
            bump: 1,
            escrow_bump: 1,
        };
        let mut remaining = orders::quote_order_fill(
            order.total_shares,
            0,
            order.total_shares,
            order.price,
            order.fee_bps,
        )
        .unwrap()
        .2;
        assert_eq!(remaining, 336);
        for shares in [100, 200, 300, 400] {
            let (_, _, debit) = orders::quote_order_fill(
                order.total_shares,
                order.filled_shares,
                shares,
                order.price,
                order.fee_bps,
            )
            .unwrap();
            remaining = remaining.checked_sub(debit).unwrap();
            order.filled_shares += shares;
        }
        assert_eq!(remaining, 0);
        let mut bytes = Vec::new();
        order.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), BidOrder::SPACE);
        assert_eq!(BidOrder::SPACE, 213);
        assert!(orders::quote_order_fill(u64::MAX, 0, u64::MAX, 1_000_000, 30).is_err());
    }
}
