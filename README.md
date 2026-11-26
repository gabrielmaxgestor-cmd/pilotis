# Sistema de Gestão Pilotis

Aplicativo web para acompanhar finanças, clientes e orçamentos, obras, equipe, POPs, conformidade e IA Operacional. Cada ambiente começa vazio. Importe ou cadastre os registros da empresa para alimentar os indicadores.

## Código

| Local | Responsabilidade |
| --- | --- |
| `src/modules/` e `src/components/ui/` | Módulos React, navegação responsiva e componentes compartilhados |
| `src/domain/` | Regras e cálculos de parcelas, DRE, folha, fluxo de caixa, cronograma e indicadores |
| `src/services/` e `src/lib/firestorePages.ts` | Transações, auditoria, consultas paginadas, fila offline e anexos |
| `server.ts` e `src/server/` | Express, verificação de ID token, consultas da IA e Gemini |
| `firestore.rules`, `storage.rules` e `firebase.json` | Regras e seleção do banco nomeado |
| `build/fieldPwa.ts` e `public/` | Manifesto, ícones e service worker |
| `src/domain/__tests__/` e `tests/` | Testes de domínio, integrações e autorização no emulador |

## Coleções do Firestore

| Uso | Caminhos |
| --- | --- |
| Empresa e equipe | `companySettings/{uid}`, `employees`, `employees/{id}/occurrences`, `allocations` |
| Comercial e financeiro | `clients`, `quotes`, `parcelas`, `transactions`, `debts` |
| Obras e campo | `projects`, `stages`, `baselines`, `scheduleProgress`, `projectRisks`, `dailyLogs`, `dailyLogs/{id}/photos`, `fieldSync` |
| Pós-obra | `projectClosures`, `projectFollowUps`, `warrantyCalls` |
| Procedimentos | `pops`, `popVersions`, `popMediaChunks` |
| Conformidade | `complianceItems`, `complianceFiles`, `tenders` |
| IA e auditoria | `conversasIA/{uid}/mensagens` (backend), `auditLogs` |

O app usa o projeto e o banco de `firebase-applet-config.json`. O banco de `firebase.json` precisa ter o mesmo identificador. As listas do cliente são filtradas por proprietário e limitadas a 201 documentos por requisição. A página extra detecta a existência de mais registros. A sincronização inicial percorre as páginas necessárias para os cálculos e a exportação. As leituras dos módulos da IA usam páginas de até 200 registros. O Admin SDK usa IAM e o backend aplica o filtro por UID da sessão.

## Conta autorizada

A conta do Pilotis é `gabrielmaxgestor@gmail.com`. Ela precisa existir no Firebase Authentication do projeto indicado em `firebase-applet-config.json`, com o provedor **E-mail/senha** e o e-mail verificado. A senha é definida no Firebase Authentication.

Para ativar a mudança em um ambiente já publicado, atualize `VITE_COMPANY_EMAIL` e `COMPANY_EMAIL` se estiverem definidas na hospedagem. Faça um novo build e publique as regras do Firestore no banco nomeado. Publique também `storage.rules` se as fotos usam Firebase Storage. Coordene as publicações na mesma janela para manter o cliente e as regras com o mesmo e-mail.

Os registros pertencem ao UID que os criou. Se a conta autorizada for trocada por uma conta com outro UID, a alteração do e-mail autorizado por si só não transfere os registros.

## Desenvolvimento e verificação

Use Node.js 24. O ambiente deve ter uma conta corporativa com e-mail verificado no Firebase Authentication. Configure o mesmo endereço em `VITE_COMPANY_EMAIL` no build do cliente, `COMPANY_EMAIL` no servidor e em `firestore.rules` e `storage.rules`. Use `.env.example` como referência local. `GEMINI_API_KEY` fica no servidor. Para consultas reais locais da IA, use credenciais padrão da aplicação (ADC) de um projeto de teste.

```sh
npm ci
npm run lint
npm test
node --test tests/integration.test.mjs
npm run dev
```

Os testes de integração executam os serviços do app com um Firestore em memória, incluindo rollback simulado. Para testar a aplicação das regras, execute o emulador em um projeto demonstrativo local com Java disponível.

```sh
npx firebase-tools emulators:exec --only firestore --project demo-pilotis "node --test tests/firestore.rules.test.mjs"
```

No navegador, repita a conferência em 390 px e 1440 px. Percorra navegação, abas e ações com Tab, Shift+Tab, setas, Enter e Escape. Confira foco visível, retorno do foco após fechar modais, texto dos status, colunas convertidas em listas e a movimentação de cartões do Kanban pelo botão **Mover**. Faça a primeira abertura da PWA online. Os registros e fotos capturados offline permanecem em fila até o servidor confirmar a gravação.

## Publicação no Cloud Run

1. Confirme o projeto, o banco nomeado e o e-mail corporativo. Use um projeto de homologação para o primeiro deploy.
2. Habilite Cloud Run, Cloud Build, Artifact Registry e Secret Manager. Crie uma conta de serviço dedicada ao runtime. Conceda acesso de leitura e gravação ao Firestore de destino (por exemplo, `roles/datastore.user` nesse projeto) e `roles/secretmanager.secretAccessor` no segredo `pilotis-gemini-api-key`. Armazene a chave Gemini no Secret Manager.
3. A partir da raiz do repositório, publique o contêiner. O exemplo usa o e-mail padrão do projeto. Para outro e-mail, alinhe também o build do cliente e as regras antes de publicar.

```sh
gcloud run deploy pilotis \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service-account "$RUNTIME_SERVICE_ACCOUNT" \
  --set-env-vars "COMPANY_EMAIL=gabrielmaxgestor@gmail.com" \
  --set-secrets "GEMINI_API_KEY=pilotis-gemini-api-key:latest" \
  --allow-unauthenticated
```

A URL da interface é pública. O Firebase Authentication protege os módulos e o endpoint de IA exige o ID token da conta verificada. O servidor lê a porta `PORT` fornecida pelo Cloud Run. Consulte `/healthz` após o deploy e verifique que `/api/ai/chat` sem token retorna 401.

4. Confirme que o cliente novo já está servindo as consultas paginadas antes de publicar as regras com limite obrigatório. Em produção, oriente usuários com uma aba antiga aberta a recarregar. Execute `npx firebase-tools deploy --only firestore:rules --project "$PROJECT_ID"`.
5. Confira o domínio do Cloud Run no Firebase Authentication e valide login, recebimentos, planejamento e IA. Aplique `storage.rules` somente se usar o modo Storage para as fotos. O modo padrão gravará JPEGs na subcoleção do Firestore. Para Storage, configure também CORS e gere a imagem com `VITE_DAILY_LOG_PHOTO_BACKEND=storage`.

Referências oficiais de publicação do [Cloud Run](https://cloud.google.com/run/docs/deploying-source-code) e de [segredos no Cloud Run](https://cloud.google.com/run/docs/configuring/services/secrets).
