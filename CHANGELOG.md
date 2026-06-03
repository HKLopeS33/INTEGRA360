# Changelog

## [1.0.9] - 2026-06-03

### Correções
- **Electron:** corrigido erro de inicialização "Cannot use import statement outside a module" que impedia o app de abrir após instalação.

### Melhorias de desempenho
- **KDS (Fila da Cozinha):** botões de avanço de etapa (Preparo → / Pronto → / Saiu p/ entrega / Marcar entregue) agora respondem instantaneamente via optimistic update — a tela atualiza na hora e sincroniza com o banco em background, eliminando a espera de 5+ segundos.

### Numeração de recibos
- **Contador único:** recibos de mesa e delivery agora compartilham a mesma sequência numérica — não é mais possível duas comandas receberem o mesmo número.
- **Número gerado ao finalizar:** pedidos de delivery recebem o número do recibo automaticamente ao serem marcados como Entregue, mesmo que o recibo não seja impresso.
- **Relatório de recibos:** pedidos de delivery agora exibem o número do recibo (ex: Nº 000015) na lista da aba Caixa.

### Permissões
- **Garçom:** usuários com perfil Garçom agora podem encerrar mesas diretamente pela tela de mesas.

---

## [1.0.8] - 2026-06-01

- Correção de compatibilidade CJS/ESM no Electron (preload.cjs + main.js).
- Integração com Supabase para pedidos de delivery.
- Melhorias gerais de estabilidade.
