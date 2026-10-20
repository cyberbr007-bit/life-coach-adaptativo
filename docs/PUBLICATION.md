# Publicação do código

A edição pública contém código genérico, testes sintéticos e documentação. É uma cópia independente, sem histórico Git da instalação privada. A licença MIT permite uso, modificação e redistribuição conforme seus termos; dependências e trechos identificados conservam seus próprios avisos.

Publique esta edição em um repositório público dedicado. Não inicialize Git nem execute git add na pasta operacional do servidor. A pasta operacional contém .env, credenciais e segredos que nunca fazem parte do código público.

Antes de publicar, confira a lista de arquivos e os hashes de SOURCE-SHA256SUMS. Não inclua node_modules, .eve, .output, sessões, logs, exports, backups ou banco. .gitignore é uma camada adicional; ele não remove conteúdo já publicado.

Não distribua os arquivos de terceiros usados como referência sem uma licença apropriada. As regras de aprendizado documentadas aqui foram escritas para o comportamento implementado neste repositório.

Publicar o software não torna público o banco de uma instalação. Não configure serviços ou telemetria que enviem dados operacionais ao GitHub. Uma atualização de código não pode sobrescrever as configurações e credenciais da instalação.

A publicação não certifica segurança, qualidade clínica, eficácia de coaching ou elegibilidade SIWC. Esses pontos exigem verificações próprias. Consulte SECURITY.md e docs/EXECUTAR.md.
