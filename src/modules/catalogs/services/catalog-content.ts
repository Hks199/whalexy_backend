export function catalogContent(
  externalId: string,
  mode: string,
  ordered: {
    sku: string;
  }[],
  body?: string,
) {
  let interactive: any;
  if (mode === 'single')
    interactive = {
      type: 'product',
      ...(body ? { body: { text: body } } : {}),
      action: { catalog_id: externalId, product_retailer_id: ordered[0].sku },
    };
  else if (mode === 'multiple')
    interactive = {
      type: 'product_list',
      header: { type: 'text', text: 'Product catalog' },
      body: { text: body || 'Select a product to view details or place an order.' },
      action: {
        catalog_id: externalId,
        sections: [
          {
            title: 'Products',
            product_items: ordered.map((p) => ({ product_retailer_id: p.sku })),
          },
        ],
      },
    };
  else
    interactive = {
      type: 'catalog_message',
      body: { text: body || 'Browse our product catalog.' },
      action: {
        name: 'catalog_message',
        ...(ordered.length
          ? { parameters: { thumbnail_product_retailer_id: ordered[0].sku } }
          : {}),
      },
    };
  return { type: 'interactive', interactive };
}
