# Segurança e privacidade

Este projeto é experimental. Não existe uma auditoria independente de segurança nem suporte permanente prometido.

Não publique tokens, senhas, chaves, arquivos de sessão, logs de conversas, dumps do banco ou dados de saúde em issues, pull requests e anexos. Para um relato público, forneça apenas uma reprodução sintética sem segredos. Não há um canal privado de vulnerabilidades definido nesta primeira edição; combine um canal privado com o mantenedor antes de compartilhar detalhes sensíveis.

Use um bot dedicado, uma instalação por proprietário e IDs numéricos verificados. O processo de configuração não deve autorizar automaticamente o primeiro remetente. Não exponha PostgreSQL publicamente. Revise qualquer webhook existente antes de usar polling.

O cofre depende de uma chave separada. Quem controla o servidor e essa chave pode acessar as credenciais. A cifragem não protege contra comprometimento completo do host. Restrinja acesso SSH, mantenha atualizações e teste backups cifrados e restauração.

Mensagens de bots Telegram não são conversas secretas com criptografia de ponta a ponta. A exclusão local não remove automaticamente cópias no Telegram, em outros provedores ou em backups externos.

O worker de fundação não executa shell ou ferramentas externas escolhidas pelo modelo. O spike eve não deve ser habilitado com dados pessoais antes de revisar as ferramentas internas do framework, a autorização e o sandbox.

Se um segredo for exposto, revogue-o no provedor e substitua-o na instalação. Apagar apenas um commit não revoga a credencial.
