use super::*;

const ORDER_SEED: &[u8] = b"ask";
const ESCROW_SEED: &[u8] = b"ask_escrow";
const PRICE_SCALE: u128 = 1_000_000;

pub fn place(
    ctx: Context<PlaceAsk>,
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
    require!(
        shares > 0 && price > 0 && u128::from(price) <= PRICE_SCALE,
        OrderError::InvalidAmount
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
    let order = &mut ctx.accounts.order;
    order.market = market.key();
    order.maker = ctx.accounts.maker.key();
    order.share_mint = expected_mint;
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
                from: ctx.accounts.maker_shares.to_account_info(),
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
            },
        ),
        shares,
        ctx.accounts.share_mint.decimals,
    )
}

pub fn fill(ctx: Context<FillAsk>, shares: u64, maximum_debit: u64) -> Result<()> {
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
    let (collateral, fee, debit) = order.quote(shares)?;
    require!(debit <= maximum_debit, OrderError::Slippage);
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.taker_collateral.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.maker_collateral.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
            },
        ),
        collateral,
        ctx.accounts.collateral_mint.decimals,
    )?;
    if fee > 0 {
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.taker_collateral.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.fee_collateral.to_account_info(),
                    authority: ctx.accounts.taker.to_account_info(),
                },
            ),
            fee,
            ctx.accounts.collateral_mint.decimals,
        )?;
    }
    let nonce = order.nonce.to_le_bytes();
    let bump = [order.bump];
    let seeds = [
        ORDER_SEED,
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
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.taker_shares.to_account_info(),
                authority: order.to_account_info(),
            },
            &[&seeds],
        ),
        shares,
        ctx.accounts.share_mint.decimals,
    )?;
    ctx.accounts.order.filled_shares = ctx
        .accounts
        .order
        .filled_shares
        .checked_add(shares)
        .ok_or(OrderError::InvalidAmount)?;
    Ok(())
}

pub fn cancel(ctx: Context<CancelAsk>) -> Result<()> {
    let order = &ctx.accounts.order;
    require!(!order.cancelled, OrderError::Cancelled);
    let nonce = order.nonce.to_le_bytes();
    let bump = [order.bump];
    let seeds = [
        ORDER_SEED,
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
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.maker_shares.to_account_info(),
                    authority: order.to_account_info(),
                },
                &[&seeds],
            ),
            ctx.accounts.escrow.amount,
            ctx.accounts.share_mint.decimals,
        )?;
    }
    ctx.accounts.order.cancelled = true;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct PlaceAsk<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()], bump = market.bump, constraint = market.collateral_mint == config.collateral_mint)]
    pub market: Account<'info, Market>,
    #[account(init, payer = maker, space = AskOrder::SPACE, seeds = [ORDER_SEED, market.key().as_ref(), maker.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub order: Account<'info, AskOrder>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Account<'info, Mint>,
    pub share_mint: Account<'info, Mint>,
    #[account(init, payer = maker, seeds = [ESCROW_SEED, order.key().as_ref()], bump, token::mint = share_mint, token::authority = order)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut, token::mint = share_mint, token::authority = maker)]
    pub maker_shares: Account<'info, TokenAccount>,
    #[account(mut)]
    pub maker: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FillAsk<'info> {
    #[account(seeds = [MARKET_SEED, market.creator.as_ref(), &market.nonce.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, has_one = market, has_one = share_mint, seeds = [ORDER_SEED, market.key().as_ref(), order.maker.as_ref(), &order.nonce.to_le_bytes()], bump = order.bump)]
    pub order: Box<Account<'info, AskOrder>>,
    #[account(address = market.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [ESCROW_SEED, order.key().as_ref()], bump = order.escrow_bump, token::mint = share_mint, token::authority = order)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = taker)]
    pub taker_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, constraint = maker_collateral.owner == order.maker)]
    pub maker_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, dup, token::mint = collateral_mint, constraint = fee_collateral.owner == order.fee_recipient)]
    pub fee_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = share_mint, token::authority = taker)]
    pub taker_shares: Box<Account<'info, TokenAccount>>,
    pub taker: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelAsk<'info> {
    #[account(mut, has_one = maker, has_one = share_mint, seeds = [ORDER_SEED, order.market.as_ref(), maker.key().as_ref(), &order.nonce.to_le_bytes()], bump = order.bump)]
    pub order: Account<'info, AskOrder>,
    pub share_mint: Account<'info, Mint>,
    #[account(mut, seeds = [ESCROW_SEED, order.key().as_ref()], bump = order.escrow_bump, token::mint = share_mint, token::authority = order)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut, token::mint = share_mint, token::authority = maker)]
    pub maker_shares: Account<'info, TokenAccount>,
    pub maker: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct AskOrder {
    pub market: Pubkey,
    pub maker: Pubkey,
    pub share_mint: Pubkey,
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

impl AskOrder {
    pub const SPACE: usize = 8 + 32 * 4 + 8 * 5 + 2 + 3;

    fn quote(&self, shares: u64) -> Result<(u64, u64, u64)> {
        let filled = self
            .filled_shares
            .checked_add(shares)
            .ok_or(OrderError::InvalidAmount)?;
        require!(
            shares > 0
                && filled <= self.total_shares
                && self.price > 0
                && u128::from(self.price) <= PRICE_SCALE
                && self.fee_bps <= MAX_FEE_BPS,
            OrderError::InvalidAmount
        );
        let before =
            (u128::from(self.filled_shares) * u128::from(self.price)).div_ceil(PRICE_SCALE);
        let after = (u128::from(filled) * u128::from(self.price)).div_ceil(PRICE_SCALE);
        let collateral = u64::try_from(after - before).map_err(|_| OrderError::InvalidAmount)?;
        require!(collateral > 0, OrderError::DustFill);
        let fee = u64::try_from(
            (after * u128::from(self.fee_bps)).div_ceil(10_000)
                - (before * u128::from(self.fee_bps)).div_ceil(10_000),
        )
        .map_err(|_| OrderError::InvalidAmount)?;
        let debit = collateral
            .checked_add(fee)
            .ok_or(OrderError::InvalidAmount)?;
        Ok((collateral, fee, debit))
    }
}

#[error_code]
pub enum OrderError {
    #[msg("Order trading is closed or expired")]
    TradingClosed,
    #[msg("Order expiry must be future and no later than market close")]
    InvalidExpiry,
    #[msg("Invalid order amount, price, fee, or overfill")]
    InvalidAmount,
    #[msg("Unexpected outcome mint or decimals")]
    WrongMint,
    #[msg("Order is cancelled")]
    Cancelled,
    #[msg("Maker cannot fill their own order")]
    SelfTrade,
    #[msg("Order debit exceeds taker limit")]
    Slippage,
    #[msg("Fill rounds to zero collateral")]
    DustFill,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_match_client_partial_fill_vectors() {
        assert!(std::mem::size_of::<FillAsk>() < 1024);
        let mut order = AskOrder {
            market: Pubkey::default(),
            maker: Pubkey::default(),
            share_mint: Pubkey::default(),
            fee_recipient: Pubkey::default(),
            nonce: 1,
            total_shares: 1000,
            filled_shares: 0,
            price: 333333,
            expires_at: 1,
            fee_bps: 30,
            cancelled: false,
            bump: 1,
            escrow_bump: 1,
        };
        assert_eq!(order.quote(1000).unwrap(), (334, 2, 336));
        let mut collateral = 0;
        let mut fees = 0;
        for shares in [100, 200, 300, 400] {
            let quote = order.quote(shares).unwrap();
            collateral += quote.0;
            fees += quote.1;
            order.filled_shares += shares;
        }
        assert_eq!((collateral, fees), (334, 2));
        assert!(order.quote(1).is_err());
        assert!(order.quote(0).is_err());
        let mut bytes = Vec::new();
        order.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), AskOrder::SPACE);
        order.filled_shares = 1;
        assert!(order.quote(1).is_err());
        order.total_shares = u64::MAX;
        order.filled_shares = 0;
        order.price = PRICE_SCALE as u64;
        assert!(order.quote(u64::MAX).is_err());
        order.fee_bps = 0;
        assert_eq!(order.quote(u64::MAX).unwrap(), (u64::MAX, 0, u64::MAX));
    }
}
