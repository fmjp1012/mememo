up:
	docker compose up -d
build:
	docker compose build --no-cache --force-rm
init:
	docker compose up -d --build
	docker compose exec laravel_app composer install
	docker compose exec laravel_app cp .env.example .env
	docker compose exec laravel_app php artisan key:generate
	docker compose exec laravel_app php artisan storage:link
	@make fresh
remake:
	@make destroy
	@make init
stop:
	docker compose stop
down:
	docker compose down --remove-orphans
restart:
	@make down
	@make up
destroy:
	docker compose down --rmi all --volumes --remove-orphans
destroy-volumes:
	docker compose down --volumes --remove-orphans
ps:
	docker compose ps
logs:
	docker compose logs
logs-watch:
	docker compose logs --follow
log-web:
	docker compose logs web
log-web-watch:
	docker compose logs --follow web
log-laravel_app:
	docker compose logs laravel_app
log-laravel_app-watch:
	docker compose logs --follow laravel_app
log-db:
	docker compose logs db
log-db-watch:
	docker compose logs --follow db
web:
	docker compose exec web ash
laravel_app:
	docker compose exec laravel_app bash
migrate:
	docker compose exec laravel_app php artisan migrate
fresh:
	docker compose exec laravel_app php artisan migrate:fresh --seed
seed:
	docker compose exec laravel_app php artisan db:seed
rollback-test:
	docker compose exec laravel_app php artisan migrate:fresh
	docker compose exec laravel_app php artisan migrate:refresh
tinker:
	docker compose exec laravel_app php artisan tinker
test:
	docker compose exec laravel_app php artisan test
optimize:
	docker compose exec laravel_app php artisan optimize
optimize-clear:
	docker compose exec laravel_app php artisan optimize:clear
cache:
	docker compose exec laravel_app composer dump-autoload -o
	@make optimize
	docker compose exec laravel_app php artisan event:cache
	docker compose exec laravel_app php artisan view:cache
cache-clear:
	docker compose exec laravel_app composer clear-cache
	@make optimize-clear
	docker compose exec laravel_app php artisan event:clear
npm:
	@make npm-install
npm-install:
	docker compose exec web npm install
npm-dev:
	docker compose exec web npm run dev
npm-watch:
	docker compose exec web npm run watch
npm-watch-poll:
	docker compose exec web npm run watch-poll
npm-hot:
	docker compose exec web npm run hot
db:
	docker compose exec db bash
sql:
	docker compose exec db bash -c 'mysql -u $$MYSQL_USER -p$$MYSQL_PASSWORD $$MYSQL_DATABASE'
redis:
	docker compose exec redis redis-cli
ide-helper:
	docker compose exec laravel_app php artisan clear-compiled
	docker compose exec laravel_app php artisan ide-helper:generate
	docker compose exec laravel_app php artisan ide-helper:meta
	docker compose exec laravel_app php artisan ide-helper:models --nowrite
phpcs:
	docker compose exec laravel_app composer phpcs -- ./
phpcbf:
	docker compose exec laravel_app composer phpcbf -- ./
format:
	docker compose exec laravel_app bash -c 'COMPOSER_MEMORY_LIMIT=-1 ./vendor/bin/phpcbf .'