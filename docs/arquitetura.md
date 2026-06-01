# Arquitetura do Sistema

## Decisao Principal

O sistema deve ser tratado como um ERP operacional para restaurante, com um nucleo local forte e integracao web progressiva.

A decisao mais importante e nao depender da internet para vender, abrir mesa, enviar pedido para cozinha ou fechar caixa. A web deve ampliar o sistema, nao ser uma fragilidade operacional.

## Modelo Hibrido Local + Web

### Local

Responsavel por operacao diaria:

- Login e permissoes locais
- Mesas e comandas
- Pedidos
- KDS/cozinha
- Caixa e pagamentos
- Estoque basico
- Relatorios locais essenciais

Banco recomendado: SQLite.

Motivo: simples de distribuir, facil de fazer backup, boa performance para PDV local e menor dependencia de infraestrutura.

### Web

Responsavel por recursos conectados:

- Backup em nuvem
- Sincronizacao entre unidades
- Painel administrativo remoto
- Relatorios consolidados
- Delivery online
- Integracoes externas
- Fiscal em ambiente controlado, quando aplicavel

Banco recomendado: PostgreSQL.

## Stack Recomendada

### Aplicacao Local

- Electron
- React
- TypeScript
- Vite
- Tailwind ou CSS modular

### Backend

- NestJS
- TypeScript
- Prisma ORM
- SQLite no modo local
- PostgreSQL no modo web

### Web Admin

- Next.js ou React SPA
- API NestJS
- PostgreSQL

### Futuro Mobile

- Flutter, se o foco for app robusto Android/iOS
- React Native, se a equipe quiser reaproveitar mais conhecimento React

## Sincronizacao

A sincronizacao deve ser baseada em eventos.

Exemplos de eventos:

- mesa_aberta
- pedido_criado
- pedido_item_adicionado
- pedido_enviado_cozinha
- pagamento_registrado
- caixa_fechado
- estoque_movimentado

Cada evento local fica salvo em uma fila. Quando houver internet, a aplicacao envia os eventos para a API web.

Campos sugeridos:

- id
- tipo
- payload
- criado_em
- sincronizado_em
- tentativas
- erro

## Modulos

### 1. Usuarios e Permissoes

Perfis iniciais:

- Administrador
- Gerente
- Caixa
- Garcom
- Cozinha
- Estoque
- Financeiro

Permissoes devem ser granulares desde o inicio, mesmo que a interface inicial use apenas perfis prontos.

### 2. Mesas e Comandas

Este e o centro operacional do restaurante.

Estados de mesa:

- livre
- ocupada
- reservada
- fechando_conta

Estados de pedido:

- enviado
- em_preparo
- pronto
- entregue
- cancelado

### 3. Cardapio

Estrutura:

- Categorias
- Produtos
- Adicionais
- Combos
- Promocoes
- Disponibilidade

Produtos devem ter preco de venda e custo estimado para permitir relatorios de margem.

### 4. Cozinha / KDS

Pedidos devem ser roteados por setor:

- cozinha
- bar
- churrasqueira
- sobremesas

O KDS deve priorizar tempo, status e origem do pedido.

### 5. Estoque

O estoque deve ser construido em duas camadas:

- estoque simples por produto/insumo
- ficha tecnica para baixa automatica

A ficha tecnica deve ser implementada depois que o fluxo de venda estiver estavel.

### 6. Financeiro

O financeiro depende de caixa e pagamentos bem estruturados.

Primeira entrega:

- abertura de caixa
- sangria
- suprimento
- pagamento
- fechamento

Depois:

- contas a pagar
- contas a receber
- centros de custo
- DRE

### 7. Fiscal

Fiscal deve ser uma fase separada, pois depende de estado, certificado, ambiente SEFAZ, regras tributarias e homologacao.

Nao deve travar o MVP.

## Fases de Desenvolvimento

### Fase 1 - MVP Operacional

- Login
- Usuarios e perfis
- Cadastro de mesas
- Cadastro de categorias e produtos
- Abertura de mesa/comanda
- Lancamento de pedido
- Envio para cozinha
- KDS basico
- Fechamento de conta
- Pagamentos simples e multiplos
- Abertura e fechamento de caixa

### Fase 2 - Gestao

- Estoque
- Ficha tecnica
- Movimentacoes
- Fornecedores
- Contas a pagar
- Contas a receber
- Relatorios principais

### Fase 3 - Web e Integracoes

- Backup online
- Painel web
- Delivery
- WhatsApp
- iFood, se viavel
- App garcom

### Fase 4 - Fiscal e Avancado

- NFC-e/SAT
- XML
- Cancelamento fiscal
- Fidelidade
- CRM
- Previsao de vendas
- Sugestao de compras

## Principais Entidades

- usuarios
- perfis
- permissoes
- mesas
- comandas
- pedidos
- pedido_itens
- categorias
- produtos
- adicionais
- produto_adicionais
- combos
- estoque_itens
- fichas_tecnicas
- movimentacoes_estoque
- caixas
- pagamentos
- clientes
- fornecedores
- contas_pagar
- contas_receber
- eventos_sincronizacao
- logs_auditoria

## Regra de Ouro

O MVP deve vender, controlar mesa, mandar pedido para cozinha e fechar caixa com seguranca.

Todo o resto deve evoluir a partir desse nucleo.
