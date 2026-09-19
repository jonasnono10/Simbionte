---
impacto: capacidade_nova
secao: adicionado
titulo: Um sistema externo pode criar empresas no CRM, se o dono da instalação ligar
---

Nova rota `POST /api/v1/tenants/provision`: um sistema de fora cria uma empresa no CRM, com a pessoa dona e uma chave de API para operá-la (com permissão de atendente), sem passar pela tela de cadastro. Repetir o pedido para a mesma empresa não cria outra: devolve a mesma empresa e uma chave nova, e a anterior deixa de valer. Se o e-mail da pessoa dona já tem conta nesta instalação, o pedido é recusado e nada é criado — quem quer essa pessoa numa empresa a convida pela tela da empresa (decisão do dono, 19/09). E se um pedido falhar no meio (o banco fora do ar por um instante, por exemplo), basta o sistema de fora repetir: ele retoma de onde parou e conclui o cadastro — a empresa criada **e** a pessoa dona com acesso a ela —, em vez de ficar dizendo para sempre que aquele e-mail já tem conta, ou de responder "está tudo certo" sobre uma empresa em que ninguém consegue entrar.

Ela vem **desligada**. Só existe quando o dono da instalação define `TENANT_PROVISIONING_SECRET` no `.env`, com 32 caracteres ou mais (`openssl rand -hex 32`), e entrega esse segredo ao sistema que vai criar empresas. Sem ele, nada muda e a rota responde como se não existisse.

Contribuição de @faxamkt (#1008).
