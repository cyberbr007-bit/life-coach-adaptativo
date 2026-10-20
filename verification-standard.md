# Padrão de verificação — fundação v0.1

Status: padrão inicial de engenharia, ainda sem homologação de produção pelo proprietário.
Durante correção, manter este arquivo e os testes de aceitação congelados. Não enfraquecer requisitos para obter PASS.

## Critérios objetivos

- TYPECHECK: npm run typecheck termina com exit code 0.
- REGRESSION: npm test termina com exit code 0, incluindo o conjunto anterior e o protocolo novo.
- EVE_BUILD: npm run eve:build compila; isso não comprova runtime completo nem acesso real.
- STANDARD_UNCHANGED: o hash deste arquivo é o mesmo antes/depois da verificação.

## Procedimento

    npm run verify

O runner registra PASS/FAIL e log por critério em docs/VALIDACAO.json e docs/validation-logs/.
Não faz correções automáticas nem muda padrões.

## Baseline

26 testes locais passaram antes da incorporação do protocolo do vídeo. São baseline técnico observado, não homologação de produção ou demonstração de melhoria de vida. A suíte adicional precisa preservar esses comportamentos.

## Bloqueios externos

Login real, Telegram real, VPS, Docker/Compose e backup externo continuam pendentes enquanto não forem executados. Ausência de execução nunca vira PASS. Eles são gates separados; este padrão local não declara o sistema pronto para produção.
