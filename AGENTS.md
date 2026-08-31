# Diretrizes para agentes

Estas instruções se aplicam a todo o repositório, salvo quando um `AGENTS.md` mais específico existir em um subdiretório.

## Princípios de trabalho

- Priorize eficiência e baixo consumo de tokens sem sacrificar qualidade, correção ou segurança.
- Analise somente os arquivos relevantes para a tarefa atual.
- Não explore o repositório inteiro sem uma necessidade concreta.
- Evite reler arquivos já compreendidos, salvo quando houver mudança ou dúvida relevante.
- Antes de alterar código, entenda o fluxo afetado e suas dependências diretas.
- Para bugs complexos, investigue o suficiente para identificar a causa antes de implementar a correção.

## Alterações

- Faça mudanças mínimas, objetivas e estritamente relacionadas ao pedido.
- Não realize refatorações, limpezas ou melhorias fora do escopo.
- Preserve a arquitetura, os padrões visuais e as regras de negócio existentes.
- Preserve alterações do usuário e arquivos não relacionados.
- Nunca exponha credenciais, tokens, senhas ou conteúdo de arquivos de ambiente.

## Validação

- Rode primeiro apenas os testes diretamente relacionados à alteração.
- Amplie a validação somente quando o risco, o impacto ou uma falha justificar.
- Para correções críticas, valide também os fluxos adjacentes que possam sofrer regressão.
- Não deixe servidores, watchers ou outros processos do projeto rodando após a conclusão, salvo solicitação explícita.

## Comunicação

- Mantenha atualizações de progresso breves e úteis.
- Nas respostas finais, informe de forma curta o resultado, os arquivos relevantes e a validação realizada.
- Evite repetir detalhes já apresentados ou explicar etapas internas sem necessidade.

## Critério de prioridade

Quando houver conflito entre economia de tokens e confiabilidade, priorize nesta ordem:

1. Correção funcional.
2. Segurança e proteção dos dados.
3. Preservação das regras de negócio.
4. Validação proporcional ao risco.
5. Eficiência e concisão.
