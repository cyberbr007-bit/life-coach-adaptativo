# Configuração e prova self-hosted

Este procedimento prepara uma instalação dedicada. Não há garantia de acesso SIWC ou de disponibilidade contínua. Primeiro valide dados sintéticos. Segredos, banco e backups pertencem à instalação e nunca devem ser enviados ao repositório.

## 1. Requisitos e identidade

Use Node 24 para desenvolvimento, Python 3 para configuração e Docker/Compose no servidor. Faça um inventário com scripts/host-inventory.sh antes de instalar serviços.

Crie um bot dedicado no BotFather. Verifique o ID numérico da sua conta por uma mensagem privada com um desafio aleatório enviado ao próprio bot e consultado pela API oficial. Não autorize automaticamente o primeiro remetente, não use o número contido no token como ID de usuário e não forneça o token a bots terceiros.

Em um diretório privado:

```bash
python3 scripts/configure.py
docker build -t life-coach:0.1 .
```

O configurador pede o token com entrada oculta e o ID verificado. Ele cria senhas, chave de cofre e host ID sem sobrescrever arquivos existentes. Nada é iniciado. OPENAI_MODEL fica vazio e SIWC_ELIGIBILITY_CONFIRMED fica no até a validação.

## 2. Elegibilidade e login

Confirme que a instalação se enquadra na modalidade vigente da OpenAI. Código open source não garante acesso de uma conta específica. Um login de identidade também não prova concessão de uso do plano. Não habilite a opção de elegibilidade apenas para ultrapassar um erro.

O fluxo de VM documentado pela OpenAI conclui OAuth no computador do navegador e transfere a sessão protegida por SSH. Um callback 127.0.0.1 no navegador chega a esse computador, não ao servidor remoto.

No computador local, instale as dependências e prepare uma chave para o cofre:

```bash
npm ci
npm run cli -- vault-init
npm run cli -- siwc-login
```

Abra o endereço de autenticação no navegador desse mesmo computador, selecione sua conta e revise as permissões. A conexão é armazenada cifrada. O host ID local e o host ID da VM devem ser diferentes e persistentes.

O arquivo cifrado só pode ser aberto pela chave correspondente. Planeje essa transferência antes de importar: uma alternativa para uma VM ainda sem sessão é copiar sua chave existente por SSH para o ambiente local privado antes do primeiro login, em vez de gerar outra chave local. Não sobrescreva um cofre ou uma chave em uso. Preserve o host ID da VM; nunca copie a pasta credentials inteira sobre ela.

Transfira somente a sessão selecionada pelo canal seguro. Pare o cliente local antes de deixar o servidor possuir as renovações. Na VM, o container usa UID/GID 1000: o arquivo de sessão deve ser privado e pertencer a esse usuário, e credentials/ deve permitir renovação atômica. Não cole URLs de callback, tokens ou arquivos de sessão em chats ou issues.

## 3. Catálogo e prova de inferência

Em um runtime com a sessão selecionada e suas variáveis configuradas:

```bash
npm run cli -- models
```

Escolha um slug do catálogo e preencha OPENAI_MODEL no .env. Quando o enquadramento elegível estiver confirmado, defina SIWC_ELIGIBILITY_CONFIRMED=yes.

```bash
npm run cli -- probe
npm run cli -- eve-probe
```

O primeiro valida Responses textual; o segundo valida só a ponte AI SDK textual. Ambos exigem resposta terminal concluída. Não habilite ENABLE_EVE_SPIKE nem o runtime eve completo com dados pessoais nesta etapa. Falha de quota ou permissão não aciona API paga.

## 4. Banco e worker

Antes dos comandos Compose, .env deve conter IDs numéricos, modelo selecionado e as variáveis requeridas; a interpolação do Compose valida esses campos inclusive em comandos voltados apenas ao banco. Não invente um modelo para contornar isso.

```bash
docker compose build
docker compose up -d db
docker compose --profile setup run --rm migrate
```

Use um volume novo e dedicado. Nunca reutilize o volume de outro projeto. Papéis são criados apenas na inicialização de um volume vazio. Alterar uma senha em arquivo não altera um banco já provisionado.

O banco não publica porta no host. A aplicação usa lc_runtime; migrações usam lc_owner. Confirme isolamento e permissões. Prepare e teste backup externo e restauração com dados sintéticos antes de armazenar dados pessoais continuamente.

```bash
docker compose up -d bot
docker compose logs --tail 50 bot
```

Não envie logs brutos sem revisão. A aplicação usa polling e recusa webhook existente; ela não o apaga automaticamente. Uma segunda instância é bloqueada por lock PostgreSQL.

## 5. Aceitação na instalação

Verifique com dados sintéticos:

1. /start responde ao proprietário; outra conta e grupos não acessam os dados.
2. /guardar limite manhã | não sugerir treino antes das 8h registra uma declaração.
3. /memoria mostra ID e conteúdo; /corrigir ID | novo valor cria outra versão.
4. Um plano respeita o limite declarado.
5. /parar durante geração impede uma resposta obsoleta de entrar na outbox.
6. /pausar permanece após reinício; /retomar não cria agendamentos ou permissões.
7. Reinício entre entrada e resposta mantém o trabalho persistido.
8. /aprendizados mostra somente o estado de observação.
9. /esquecer exige confirmação válida e elimina dados locais conforme o escopo indicado.
10. Quota, sessão revogada e falha de rede não habilitam outra cobrança.
11. Logs não contêm segredos ou conversas; consumo de recursos e backup/restore são medidos.

Envio ao Telegram não tem garantia de exactly-once; timeouts podem duplicar texto. Uma entrega já em trânsito pode escapar do cancelamento. Exclusão local não remove cópias nos provedores nem em backups externos. Updates Telegram têm retenção limitada.

## Fontes oficiais

- [OpenAI SIWC: disponibilidade e modalidades](https://developers.openai.com/siwc/quickstart)
- [OpenAI SIWC: aplicações open source](https://developers.openai.com/siwc/token-sharing-open-source)
- [OpenAI SIWC: VMs self-hosted](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- [OpenAI SIWC: contas e sessões](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Docker Engine no Ubuntu](https://docs.docker.com/engine/install/ubuntu/)

Consulte também a documentação da versão instalada do Chat SDK e de eve antes de modificar seus contratos. O build do projeto não comprova uma integração real.
