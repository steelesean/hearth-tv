// The account's credit over the next twelve months: today's balance, plus each Direct Debit, less what each day is
// expected to cost. Electricity, the car and standing charges go at their recent pace; gas follows the season, from
// this house's own gas per degree of cold and a typical year's weather here, and the weather forecast for the next
// fortnight. It's an outlook, not a promise: prices, the weather and the household all move.

const DAY = 24 * 60 * 60 * 1000;
const addDays = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const monthOnly = (date) => new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
// "March", but "October 2027" when this is October, so it can't be read as now
const monthName = (date, today) => monthOnly(date) + (today && date.slice(5, 7) === today.slice(5, 7) && date.slice(0, 4) !== today.slice(0, 4) ? " " + date.slice(0, 4) : "");
const round = (x) => Math.round(x * 100) / 100;

/**
 * balance: pounds in credit today (negative if owed). today: "YYYY-MM-DD".
 * payment: { amount, day } the monthly Direct Debit. perDay: pounds a day for everything but gas.
 * gasKwh(date): expected gas that day. gasPence: pence a kWh.
 */
export function creditOutlook({ balance, today, payment, perDay, gasKwh, gasPence }) {
  let bal = balance, low = { balance: balance, date: today }, high = { balance: balance, date: today }, firstOwed = null;
  const months = [];
  for (let i = 1; i <= 365; i++) {
    const d = addDays(today, i);
    if (Number(d.slice(8, 10)) === payment.day) bal += payment.amount;
    bal -= perDay + (gasKwh(d) * gasPence) / 100;
    if (bal < low.balance) low = { balance: bal, date: d };
    if (bal > high.balance) high = { balance: bal, date: d };
    if (bal < 0 && !firstOwed) firstOwed = d;
    if (addDays(d, 1).slice(8, 10) === "01") months.push({ month: d.slice(0, 7), balance: round(bal) });
  }
  const out = {
    balance: round(balance), payment, months, end: round(bal),
    low: { balance: round(low.balance), date: low.date, month: monthName(low.date, today) },
    high: { balance: round(high.balance), date: high.date, month: monthName(high.date, today) },
  };
  if (firstOwed) {
    // how much more a month, from the next payment, would keep it above zero through the low point
    const paymentsBefore = Math.max(1, Math.round((Date.parse(low.date) - Date.parse(today)) / (30.4 * DAY)));
    out.owedFrom = { date: firstOwed, month: monthName(firstOwed, today), extraPerMonth: Math.ceil(-low.balance / paymentsBefore) };
  }
  return out;
}

/** The card and the plain sentence for "Good to know". The balance itself is in the header, so the card is the outlook. */
export function creditWords(o) {
  const gbp = (x) => "£" + Math.round(Math.abs(x));
  const now = o.balance >= 0 ? gbp(o.balance) + " in credit" : gbp(o.balance) + " owed";
  if (o.owedFrom) return {
    figure: "Owing by " + o.owedFrom.month,
    caption: `Winter should use up the credit. About ${gbp(o.owedFrom.extraPerMonth)} more a month would cover it.`,
    facts: `The account is ${now}. With the ${gbp(o.payment.amount)} Direct Debit and a typical winter, it should run out around ${o.owedFrom.month} and reach about ${gbp(o.low.balance)} owed in ${o.low.month}. Raising the Direct Debit by about ${gbp(o.owedFrom.extraPerMonth)} a month would keep it in credit.`,
  };
  if (o.low.balance < o.balance - 20) return {
    figure: gbp(o.low.balance) + " by " + o.low.month,
    caption: "your credit's low point this winter, before it builds again",
    facts: `The account is ${now}. With the ${gbp(o.payment.amount)} Direct Debit, the heating season should draw it down to about ${gbp(o.low.balance)} in ${o.low.month}, and it should be about ${gbp(o.end)} this time next year.`,
  };
  return {
    figure: gbp(o.high.balance) + " by " + o.high.month,
    caption: "where your credit's heading at this rate",
    facts: `The account is ${now}. The ${gbp(o.payment.amount)} Direct Debit is more than the house is expected to use, so the credit should build to about ${gbp(o.high.balance)} by ${o.high.month}${o.high.balance > 300 ? ". Octopus will refund credit if asked, or the Direct Debit could come down" : ""}.`,
  };
}
