# Auditoria de rascunhos e pedidos — 09/10/2026

Escopo: criação e edição de pedidos, persistência no aparelho, backup SQLite, restauração e confirmação de envio. Inspeção de código e testes locais; sem implantação na VPS e sem acesso ao aparelho da Zenaide. O desaparecimento do cliente 3923 não pôde ser reconstruído por falta do banco e dos registros daquele aparelho.

## Falhas encontradas e correções

| Situação | Risco observado | Correção |
| --- | --- | --- |
| Diminuir quantidade quando estoque vira zero | Remoção completa do item | Redução respeita exclusivamente a quantidade solicitada |
| Trocar empresa/tabela | Carrinho apagado imediatamente | Confirmação antes de limpar |
| Salvar e sair | Tela fechava sem aguardar armazenamento | Aguarda gravação e permanece aberta se ambos os armazenamentos falharem |
| Autosalvamento | Empresa/operação não disparavam gravação | Incluídas nas dependências; cópia síncrona após atualização da tela |
| Gravações locais concorrentes | Escrita antiga podia terminar por último | Fila de gravação com cópia imutável dos dados |
| Lista global sobrescrita por outra aba | Pedidos ausentes da lista podiam desaparecer | Registro independente por pedido e união na recuperação |
| Exclusão offline antes do primeiro backup | Pedido saía da fila de sincronização | Registro arquivado local permanece elegível para backup |
| Digitação contínua | Reiniciava temporizador de backup indefinidamente | Temporizador estável de 5 segundos, sem reenviar versões confirmadas |
| Falha de backup/requisição parada | Falha silenciosa ou sincronização bloqueada | Aviso, timeout e novas tentativas |
| Exclusão parcial ou total de itens | Backup perdia versões anteriores | Histórico transacional no servidor e no IndexedDB |
| Requisição antiga de outro aparelho | Versão era ignorada e irrecuperável | Arquivamento da versão recebida antes de atualizar a cópia atual |
| Horários iguais entre edições | Colisão no identificador de versão | Histórico do servidor identificado pelo conteúdo |
| Restaurar histórico | Sobrescrita do pedido atual | Restauração cria novo identificador |
| Envio sem NUNOTA confirmado | Rascunho removido sem identificação no ERP | Exige número confirmado e backup prévio; falha preserva o rascunho |
| Limites de listagem de backups | Pedidos antigos ficavam inacessíveis | Removidos limites fixos de recuperação |

## Validação

Testes comportamentais cobrem redução com estoque zero, exclusão parcial/total, versões recebidas fora de ordem e com horários iguais, isolamento entre usuários, registros de duas abas, exclusão offline e falha/espera de gravação antes de sair. Build e testes gerais do app também executados. Esses testes não equivalem a testes em aparelhos físicos ou à inspeção do armazenamento da VPS.

## Limites e pontos operacionais

- Dados digitados offline dependem do armazenamento do aparelho até sincronizarem. Limpar os dados do site, desinstalar com remoção de dados, falha física ou encerrar o processo antes de qualquer gravação não permitem garantia absoluta de recuperação.
- A confirmação na nuvem depende de sessão válida, rede e disponibilidade do servidor. Erros ficam visíveis e mantêm a cópia local; a próxima sincronização tenta novamente.
- Histórico local e remoto aumentam o uso de disco. Não há expurgo automático de versões nesta correção, para não eliminar pedidos recuperáveis.
- O SQLite na VPS ainda precisa de backup externo independente para proteger contra perda do servidor/disco. Essa configuração não foi verificada nesta auditoria local.
- Se a conexão cair depois que o Sankhya recebeu o pedido mas antes da resposta, o rascunho permanece. O envio ainda não tem chave de idempotência no ERP: é necessário conferir o pedido no Sankhya antes de repetir um envio com resultado incerto, para evitar duplicação.
- Edição simultânea do mesmo rascunho em aparelhos diferentes preserva versões recebidas no histórico; não combina automaticamente as alterações de ambos.

As correções estão locais e precisam ser publicadas para entrar em vigor nos aparelhos.
