// Solana logomark (three bands) as inline SVG — inherits `color` via currentColor.

export const SOL_CURRENCY_SVG = `<svg class="sol-currency-icon" viewBox="0 0 16 12" width="0.88em" height="0.66em" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M0 0h10.3L8.2 2.1H0V0z" opacity="0.55"/><path d="M0 4.5h5.9L3.8 6.6H0V4.5z" opacity="0.82"/><path d="M0 9h10.3L8.2 11.1H0V9z"/></g></svg>`;

/** @param {string} amountEscaped already-escaped numeric string */
export function solAmountHtml(amountEscaped) {
  return `${SOL_CURRENCY_SVG}<span class="sol-amount__num">${amountEscaped}</span>`;
}
