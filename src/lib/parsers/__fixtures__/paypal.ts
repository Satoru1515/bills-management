import type { RawEmail } from "@/lib/domain/types";

/**
 * PayPal emails modeled on real ones (amounts, ids and merchants changed).
 * `date` is Gmail's receive time in UTC; bodies are plain text as the Gmail client will produce.
 */

const FROM = "PayPal <service@intl.paypal.com>";
const FOOTER =
  "Help & Contact | Security | Apps\n\nPlease don't reply to this email. To get in touch with us, click Help & Contact.\n\nCopyright © 1999-2026 PayPal. All rights reserved.";

function email(id: string, subject: string, date: string, body: string): RawEmail {
  return {
    id,
    threadId: `thread-${id}`,
    from: FROM,
    subject,
    date,
    // Gmail snippets are the first ~200 characters of the body flattened to one line.
    snippet: body.replace(/\s+/g, " ").slice(0, 200),
    body: `${body}\n\n${FOOTER}`,
  };
}

interface Receipt {
  merchant: string;
  paidLine?: string;
  amount: string;
  transactionDate?: string | null;
  funding?: string | null;
}

function receipt(r: Receipt): string {
  const lines = [
    "Hello, Satoru Yano",
    r.paidLine ?? `You paid ${r.amount} to ${r.merchant}`,
    "",
    "Transaction ID",
    "5M370362P66534715",
  ];
  if (r.transactionDate !== null) {
    lines.push("Transaction date", r.transactionDate ?? "4 Oct 2026");
  }
  lines.push(
    "",
    "Merchant",
    `${r.merchant}`,
    "support@example.com",
    "",
    "Description | Unit price | Qty | Amount",
    `Subscription | ${r.amount} | 1 | ${r.amount}`,
    "",
    `Paid ${r.merchant} with`,
  );
  if (r.funding !== null) lines.push(r.funding ?? `Visa-7782 | ${r.amount}`);
  return lines.join("\n");
}

/** The example from docs/parsing-spec.md §4, received at 10:22:31 DR time (14:22:31 UTC). */
export const spotify = email(
  "paypal-spotify-1",
  "Receipt for Your Payment to Spotify AB",
  "2026-10-04T14:22:31.000Z",
  receipt({ merchant: "Spotify AB", amount: "$11.99 USD" }),
);

/** "Sept" abbreviation, thousands separator and a Mastercard. */
export const septWithThousands = email(
  "paypal-sept-1",
  "Receipt for Your Payment to Steam Games",
  "2026-09-30T23:45:00.000Z",
  receipt({
    merchant: "Steam Games",
    amount: "$1,204.50 USD",
    transactionDate: "30 Sept 2026",
    funding: "Mastercard-1234 | $1,204.50 USD",
  }),
);

/** Paid from the PayPal balance: there is no card line. */
export const paypalBalance = email(
  "paypal-balance-1",
  "Receipt for Your Payment to Crunchyroll LLC",
  "2026-10-02T01:05:09.000Z",
  receipt({
    merchant: "Crunchyroll LLC",
    amount: "$7.99 USD",
    transactionDate: "1 Oct 2026",
    funding: "PayPal balance | $7.99 USD",
  }),
);

/** Recurring payment wording. */
export const automaticPayment = email(
  "paypal-auto-1",
  "Receipt for your payment to Netflix International B.V.",
  "2026-10-06T12:00:00.000Z",
  receipt({
    merchant: "Netflix International B.V.",
    paidLine: "You sent an automatic payment of $15.49 USD to Netflix International B.V.",
    amount: "$15.49 USD",
    transactionDate: "6 Oct 2026",
  }),
);

/** HTML flattened to a single line by the HTML-to-text conversion. */
export const flattened = email(
  "paypal-flat-1",
  "Receipt for Your Payment to Spotify AB",
  "2026-10-04T14:22:31.000Z",
  "Hello, Satoru Yano You paid $11.99 USD to Spotify AB Transaction ID 5M370362P66534715 Transaction date Oct 4, 2026 Merchant Spotify AB support@spotify.com Paid Spotify AB with Visa-7782 | $11.99 USD",
);

/** No "Transaction date" line: the reception date and time are used. */
export const noTransactionDate = email(
  "paypal-nodate-1",
  "Receipt for Your Payment to Spotify AB",
  "2026-10-04T14:22:31.000Z",
  receipt({ merchant: "Spotify AB", amount: "$11.99 USD", transactionDate: null }),
);

/** A currency the app does not track. */
export const euros = email(
  "paypal-eur-1",
  "Receipt for Your Payment to Humble Bundle",
  "2026-10-03T16:00:00.000Z",
  receipt({ merchant: "Humble Bundle", amount: "€20.00 EUR" }),
);

export const moneyReceived = email(
  "paypal-received-1",
  "You've got money",
  "2026-10-05T13:00:00.000Z",
  "Hello, Satoru Yano\nJuan Perez sent you $25.00 USD\n\nTransaction ID\n1AB23456CD789012E\nTransaction date\n5 Oct 2026",
);

export const refund = email(
  "paypal-refund-1",
  "Refund from Spotify AB",
  "2026-10-05T15:00:00.000Z",
  "Hello, Satoru Yano\nSpotify AB sent you a refund of $11.99 USD\n\nTransaction ID\n9ZY87654XW321098V\nTransaction date\n5 Oct 2026",
);

export const promotion = email(
  "paypal-promo-1",
  "Pay in 4 is here: shop now, pay later",
  "2026-10-05T17:00:00.000Z",
  "Hello, Satoru Yano\nSplit your next purchase into 4 interest-free payments. Last month you paid $0.00 in fees.",
);
