// TODO confirm with Deepankar: variant_id or product_id in the q param?
// Defaulting to product_id (ORTHO_BRACES_KIT format) since variant_id
// (DN-ON-1001) appears to be Dentira-internal. Switch to 'variantId'
// if Deepankar confirms otherwise.
export const DENTIRA_PROCUREMENT_BASE_URL = 'https://www.dentira.com/product';

export const PROCUREMENT_IDENTIFIER_FIELD: 'variantId' | 'productId' = 'productId';

export function buildProcurementUrl(
  products: Array<{ dentiraVariantId: string; dentiraProductId: string }>,
): string {
  const ids = products.map(p =>
    PROCUREMENT_IDENTIFIER_FIELD === 'productId' ? p.dentiraProductId : p.dentiraVariantId,
  );
  const params = new URLSearchParams({ q: ids.join(' ') });
  return `${DENTIRA_PROCUREMENT_BASE_URL}?${params.toString()}`;
}
