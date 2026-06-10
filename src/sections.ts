/**
 * Advisory map of which Flex sections each saved query is expected to contain.
 *
 * IMPORTANT: these are the best-known XML *element* names returned by the Flex
 * Web Service. They differ from the display names in the portal UI, and a few
 * may vary by account/region. The parser does NOT rely on this list - it
 * auto-discovers whatever sections the XML actually contains. Run
 * `ib raw <query>` to see the real element names your account returns, then
 * correct anything here. This map only powers the `ib sections` overview and
 * the friendly per-section views.
 */
export const QUERY_BLUEPRINT: Record<string, string[]> = {
  account: ["AccountInformation", "SecuritiesInfo", "ConversionRates"],
  positions: [
    "OpenPositions",
    "PriorPeriodPositions",
    "ComplexPositions",
    "NetStockPositionSummary",
    "PendingExcercises",
  ],
  trades: [
    "Trades",
    "UnbookedTrades",
    "OptionEAE",
    "TradeTransfers",
    "TransactionTaxes",
    "Commissions",
    "RoutingCommissions",
  ],
  cash: [
    "CashReport",
    "CashTransactions",
    "StmtFunds",
    "Transfers",
    "UnsettledTransfers",
    "DebitCardActivities",
  ],
  income: [
    "CorporateActions",
    "OpenDividendAccruals",
    "ChangeInDividendAccruals",
    "InterestAccruals",
    "TierInterestDetails",
  ],
  performance: [
    "ChangeInNAV",
    "EquitySummaryInBase",
    "MTMPerformanceSummaryInBase",
    "RealizedUnrealizedPerformanceSummaryInBase",
    "MTDYTDPerformanceSummary",
  ],
  fx: ["FxPositions", "FxTransactions", "ConversionRates"],
  lending: ["ClientFees", "SLBActivities", "SLBFees"],
  fills: ["TradeConfirms"],
};
