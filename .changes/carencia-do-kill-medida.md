---
impacto: nada_mudou
secao: corrigido
titulo: A conta que mantém o aviso de tempo funcionando ficou escrita ao lado do número
---

O aviso que a verificação automática dá quando uma parte dela passa do tempo
previsto depende de uma folga de poucos segundos para conseguir ser escrito
antes de a rodada ser encerrada. Essa folga existia e estava correta, mas o
número que a sustenta só existia numa conversa — então quem ajustasse a margem
no futuro poderia calar o aviso sem perceber.

Agora a medição está escrita ao lado da constante, com a conta refeita e o
limite mínimo declarado.

Para quem opera um servidor, nada muda: isto acontece inteiramente na esteira de
verificação do projeto, antes de qualquer versão ser publicada.
