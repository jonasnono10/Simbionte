---
impacto: capacidade_nova
secao: adicionado
titulo: Um comando tira esta instalação do Docker sem encostar no resto do servidor
---

Tirar o CRM de uma VPS era trabalho manual, e o atalho que todo mundo conhece — `docker system
prune -a` — é o errado: numa VPS que hospeda mais de uma coisa, ele leva junto containers, volumes
e imagens de aplicações que ninguém pediu para apagar.

Agora existe `desinstalar_docker.sh`, na raiz do repositório. Ele descobre o projeto pelo label que
o Docker Compose grava e remove **apenas** os containers, os volumes e as redes internas deste
projeto. Ficam intactos: as outras aplicações do mesmo servidor, as imagens, o cache de build, a
rede externa do proxy reverso, o código, o `.env`, os backups e um Supabase externo.

Antes de remover qualquer coisa, o script mostra o daemon escolhido, o nome do projeto, o diretório
da instalação e quantos containers, volumes e redes encontrou — e pede que você digite
`REMOVER-<nome-do-projeto>` para confirmar. Em rotina automatizada, `--force` pula a pergunta; se a
instalação usa um `COMPOSE_PROJECT_NAME` personalizado que não está mais no `.env`, `--project-name`
diz qual é. Quando duas cópias do repositório dividem o mesmo nome de projeto e a outra ainda existe
no disco, o script para e manda rodar a partir dela, em vez de assumir que os recursos são seus.

Os volumes incluem as sessões locais do WhatsApp: rode `backup.sh` antes se precisar preservá-las.
Quem não executar o script não tem nada a fazer — nenhuma variável nova, nenhum passo na
atualização.

Trabalho de @betoarts, recortado do #714.
