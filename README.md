# Life Coach Adaptativo

Fundação open source para um assistente pessoal longitudinal, com interface Telegram, memória PostgreSQL e contexto selecionado a cada interação.

**Versão 0.1.0: experimental. O ciclo adaptativo completo ainda não está implementado.** Esta versão não demonstra melhoria de resultados de vida nem está homologada para uso contínuo com dados pessoais.

## Ideia

O modelo fornece inteligência. A instalação mantém a memória canônica. Eventos, declarações, inferências e estratégias devem ser distinguíveis e rastreáveis. Mudanças aprendidas precisam de evidências, avaliações e reversão, sem reescrita livre da constituição.

Uma preferência do usuário não é um defeito. Limites explícitos prevalecem sobre estratégias de produtividade. Contato proativo e promoção autônoma começam desabilitados.

## Implementado

- Interface Telegram privada, restrita por IDs numéricos configurados pelo proprietário.
- Polling via Chat SDK, com estado PostgreSQL e deduplicação de updates.
- Eventos, memórias declaradas, versões, correções e validade temporal.
- Compilação seletiva de contexto com manifesto de origem e hash.
- Jobs com leases, cancelamento de respostas antigas e outbox com entrega limitada por tentativas.
- Comandos de memória, pausa, interrupção, status e exclusão local confirmada.
- Login OAuth com PKCE, state, nonce e validação de ID token; cofre cifrado e refresh serializado.
- Transporte textual SIWC/Responses, condicionado a elegibilidade e escopos.
- Padrões de verificação, incidentes e regras candidatas em modo de observação.
- Docker Compose e papéis separados para administração, migração e aplicação.

O processo de prova usa um worker próprio. O spike eve/AI SDK textual é separado e permanece bloqueado por padrão. Ferramentas internas, sandbox e contexto do runtime eve completo ainda exigem revisão antes de qualquer uso com dados pessoais.

## Fluxo de dados

Uma mensagem autorizada vira um evento e um job persistidos em transação. O worker monta um contexto limitado, solicita uma resposta e só registra sucesso após o evento terminal de conclusão. A resposta entra na outbox antes do envio ao Telegram. Identidade, versão de controle e leases são checados para impedir que trabalhos obsoletos avancem.

## Requisitos

- Node.js 24 e npm para desenvolvimento.
- Python 3 para o configurador.
- Docker Engine e Compose para a prova self-hosted.
- Bot Telegram dedicado e ID do proprietário verificado.
- Acesso OpenAI elegível para a modalidade SIWC utilizada.

## Desenvolvimento

```bash
npm ci
npm run verify
npm run doctor
```

Os testes usam PGlite/PostgreSQL embarcado e serviços simulados. Não forneça segredos para rodá-los. O relatório local fica em `docs/VALIDACAO.json`; os logs ficam em `docs/validation-logs/`.

## Configuração e implantação

Leia [docs/EXECUTAR.md](docs/EXECUTAR.md). O configurador cria segredos privados sem sobrescrever os existentes. Nunca publique `.env`, `secrets/`, `credentials/`, volumes, backups ou exportações de conversas.

SIWC não é uma garantia de inferência incluída para qualquer instalação. O uso do plano depende das regras atuais da OpenAI, da conta, dos escopos concedidos e dos limites. Um login bem-sucedido não comprova inferência. Não há fallback automático para API paga. Consulte as [fontes oficiais](docs/EXECUTAR.md#fontes-oficiais) e valide uma resposta concluída antes de ativar o bot.

## Ainda pendente

Extração automática de memória com revisão, scheduler, calendário, acordos de acompanhamento por domínio, hipóteses longitudinais, experimentos, avaliação histórica, promoção e rollback de estratégias. Backup externo, restauração e monitoramento precisam ser implementados e testados na instalação de destino.

O bot não é um serviço de emergência nem substitui acompanhamento profissional de saúde. Sua autonomia atual se limita ao comportamento descrito no código e nos controles; ele não altera tratamentos nem realiza ações financeiras.

## Licença e contribuições

Código do projeto sob [MIT](LICENSE). Dependências conservam suas próprias licenças; veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Orientações: [CONTRIBUTING.md](CONTRIBUTING.md) e [SECURITY.md](SECURITY.md).
