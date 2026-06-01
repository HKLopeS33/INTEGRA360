# Modelo de Dados Inicial

Este documento descreve as tabelas iniciais para o MVP. A modelagem final deve ser implementada no Prisma.

## usuarios

- id
- nome
- email
- senha_hash
- perfil_id
- ativo
- criado_em
- atualizado_em

## perfis

- id
- nome
- descricao

## permissoes

- id
- chave
- descricao

## perfil_permissoes

- perfil_id
- permissao_id

## mesas

- id
- numero
- nome
- capacidade
- status
- ativa

Status:

- livre
- ocupada
- reservada
- fechando_conta

## comandas

- id
- mesa_id
- usuario_abertura_id
- status
- aberta_em
- fechada_em
- subtotal
- desconto
- taxa_servico
- total

Status:

- aberta
- fechando
- fechada
- cancelada

## pedidos

- id
- comanda_id
- usuario_id
- status
- origem
- criado_em
- atualizado_em

Status:

- enviado
- em_preparo
- pronto
- entregue
- cancelado

Origem:

- mesa
- balcao
- delivery
- qr_code

## pedido_itens

- id
- pedido_id
- produto_id
- quantidade
- preco_unitario
- observacao
- status
- criado_em

## categorias

- id
- nome
- ordem
- ativa

## produtos

- id
- categoria_id
- nome
- descricao
- preco
- custo
- codigo_interno
- codigo_barras
- tempo_preparo_minutos
- disponivel
- ativo

## adicionais

- id
- nome
- preco
- ativo

## pedido_item_adicionais

- pedido_item_id
- adicional_id
- quantidade
- preco_unitario

## caixas

- id
- usuario_abertura_id
- usuario_fechamento_id
- aberto_em
- fechado_em
- valor_inicial
- valor_fechamento
- status

## pagamentos

- id
- comanda_id
- caixa_id
- forma
- valor
- status
- criado_em

Formas:

- dinheiro
- credito
- debito
- pix
- voucher

## eventos_sincronizacao

- id
- tipo
- payload_json
- criado_em
- sincronizado_em
- tentativas
- erro

## logs_auditoria

- id
- usuario_id
- acao
- entidade
- entidade_id
- dados_json
- criado_em
