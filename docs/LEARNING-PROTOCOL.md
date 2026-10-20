# Protocolo de aprendizado da fundação

O objetivo é registrar por que uma mudança parece válida e possibilitar revisão e reversão. Nesta versão o processo permanece em observação: não há promoção autônoma de estratégias.

| Registro | Função |
| --- | --- |
| lc_verification_standards | Padrão por versão e hash; UPDATE/DELETE são rejeitados |
| lc_verification_runs | Critérios PASS/FAIL com evidências |
| lc_learning_incidents | Origem, verificações, síntese, escopo e reversão |
| lc_rule_candidates | Recorrências suficientes geram somente candidatura |

Um defeito reproduzido exige dois runs falhos distintos do mesmo critério e padrão. Uma candidatura recorrente exige três fontes episódicas distintas. A independência real dos episódios e a causalidade não são demonstradas apenas pela contagem.

Oportunidades ficam como propostas. Mudanças em áreas protegidas precisam de revisão. Duas tentativas de correção fracassadas interrompem o ciclo. O módulo não autoriza um modelo a alterar código, testes, produção ou objetivos fundamentais.

As funções precisam ser chamadas por código confiável de avaliação. Ainda não existe um worker autônomo extraindo incidentes do cotidiano. /aprendizados mostra o estado em observação.

PASS/FAIL é usado para critérios objetivos de execução. Dados da vida podem ser quantitativos ou qualitativos. A validade de uma estratégia pessoal depende de resultados, preferências, custo, contexto e incerteza; não se resume a um teste binário.
