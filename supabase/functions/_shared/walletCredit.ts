// Helpers para creditar a carteira (Wallet) da empresa via RPC atômica
// `credit_wallet`. Usados por mais de uma Edge Function (webhook de
// pagamento e pagamento de cartão em página) — centralizados aqui para
// não duplicar a lógica de comissão de delivery.

export async function creditDeliveryWallet(adminClient: any, companyId: string, amount: number, deliveryOrderId: string) {
  const { data: wallet } = await adminClient
    .from('Wallet')
    .select('deliveryFeePercent')
    .eq('companyId', companyId)
    .maybeSingle();
  const feePercent = Number(wallet?.deliveryFeePercent ?? 0);
  const netAmount = amount * (1 - feePercent / 100);

  const { error } = await adminClient.rpc('credit_wallet', {
    p_company_id: companyId,
    p_amount: netAmount,
    p_type: 'CREDITO_DELIVERY',
    p_description: `Pedido delivery ${deliveryOrderId} (comissão ${feePercent}%)`,
    p_delivery_order_id: deliveryOrderId,
    p_tab_id: null,
  });
  if (error) console.error('Failed to credit wallet (delivery)', error);
}

export async function creditTabWallet(adminClient: any, companyId: string, amount: number, tabId: string) {
  const { error } = await adminClient.rpc('credit_wallet', {
    p_company_id: companyId,
    p_amount: amount,
    p_type: 'CREDITO_MESA',
    p_description: `Pix mesa/comanda ${tabId}`,
    p_delivery_order_id: null,
    p_tab_id: tabId,
  });
  if (error) console.error('Failed to credit wallet (mesa)', error);
}
