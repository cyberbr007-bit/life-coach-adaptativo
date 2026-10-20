# Registro de execução

Este arquivo começa sem histórico pessoal ou incidentes privados. PostgreSQL é a fonte canônica para o aprendizado da instalação; Markdown é documentação de desenvolvimento.

Para um defeito real de engenharia, registre:

- Data e situação observada.
- Evidência reproduzível com dados sintéticos.
- Causa identificada e limite de confiança.
- Correção discreta e escopo.
- Verificação executada e resultado.
- Como reverter a mudança.
- Estado: observado, candidato, aprovado ou retirado.

Repetição pode justificar uma regra candidata, mas não comprova causalidade e não altera a constituição. Preferências do usuário não são defeitos. Evite transformar oportunidades de melhoria em mudanças de comportamento sem avaliação.

## 2026-10-20 — acesso aos segredos de bootstrap

- Observado em revisão anterior à primeira inicialização: o configurador criava migrator-url e as senhas do banco como root:root 0600. O migrador executa como UID 1000; o entrypoint oficial do PostgreSQL reduz privilégios antes de processar init-roles.sh. Esses consumidores não poderiam ler os arquivos de segredo montados pelo Compose.
- Correção: incluir migrator-url na propriedade do migrador; preparar os três arquivos de bootstrap com o UID/GID consultado na imagem efetiva do PostgreSQL. Preservar conteúdo e modo 0600. A preparação testa leitura dentro do container sem iniciar o banco.
- Verificação local: typecheck e build eve aprovados; 30/30 testes Node aprovados; regressão do configurador com chown simulado aprovada; sintaxe Bash aprovada. Três testes de acesso por UID foram ignorados porque este host rejeita chown para outros UIDs. Docker e bootstrap reais precisam ser verificados na instalação, sem converter sua ausência em aprovação.
- Reversão: restaurar os scripts anteriores apenas se forem substituídos por outro provisionamento compatível. Restaurar arquivos como root:root 0600 recupera a propriedade anterior, mas reintroduz a falha de leitura. Nenhuma alteração de senha ou exclusão de volume é necessária.
- Estado: defeito de engenharia identificado; não é aprendizado comportamental nem promoção de regra do coach.
