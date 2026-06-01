# Sistema de Gestao para Restaurante

Aplicacao local com integracao web para gestao completa de restaurante, unindo PDV, mesas, comandas, cozinha, estoque, financeiro, delivery, relatorios, usuarios e futuras integracoes fiscais.

## Objetivo

Construir um sistema operacional para restaurante que funcione localmente mesmo sem internet, mas com capacidade de sincronizar dados, relatórios, backups e integracoes com servicos web.

## Modulos Principais

- Login, usuarios, permissoes e auditoria
- Frente de caixa / PDV
- Controle de mesas e comandas
- Cardapio, produtos, adicionais, combos e promocoes
- Cozinha / KDS
- Estoque com ficha tecnica e baixa automatica
- Financeiro, caixa, contas a pagar, contas a receber e DRE
- Formas de pagamento, incluindo multiplos pagamentos
- Delivery e integracoes futuras
- Relatorios e dashboards
- Fiscal / NFC-e em fase posterior
- Aplicativo garcom em fase posterior

## Estrategia

O desenvolvimento sera feito por fases. A primeira versao deve resolver o fluxo essencial do restaurante:

1. Login
2. Mesas
3. Comandas
4. Pedidos
5. Cardapio
6. Caixa
7. Pagamentos

Depois disso entram estoque, financeiro, relatorios, delivery, fiscal e integracoes.

## Arquitetura Recomendada

Para atender ao requisito de aplicacao local com integracao web:

- App local: Electron + React
- API local: Node.js + NestJS
- Banco local: SQLite
- Banco web: PostgreSQL
- ORM: Prisma
- Sincronizacao: fila local de eventos + API web
- Cache/filas web: Redis em fase futura
- Mobile garcom: Flutter ou React Native em fase futura

Mais detalhes estao em [docs/arquitetura.md](docs/arquitetura.md).

## Como Rodar em Desenvolvimento

Instale as dependencias:

```bash
npm.cmd install
```

Gere o Prisma Client:

```bash
npm.cmd run db:generate
```

Suba a API local:

```bash
npm.cmd run dev:api
```

Em outro terminal, suba a interface local:

```bash
npm.cmd run dev:desktop
```

URLs padrao:

- API local: http://localhost:3333
- Interface local: http://127.0.0.1:5173

No Windows, tambem e possivel iniciar os dois servidores com:

```bash
start-local.cmd
```

## Estado Atual

A base tecnica inicial ja possui:

- Monorepo com workspaces npm
- API local NestJS com rotas de login, mesas, cardapio, pedidos, cozinha e caixa
- Interface React/Vite para painel inicial do PDV
- Estrutura Electron preparada para empacotamento desktop
- Prisma com schema SQLite inicial

Nesta etapa, a API ainda usa dados em memoria para acelerar o desenho do fluxo. A proxima etapa deve ligar os modulos ao Prisma/SQLite e criar migrations/seeds.
