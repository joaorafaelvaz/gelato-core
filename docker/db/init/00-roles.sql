-- gelato_owner (POSTGRES_USER) é o dono do schema e roda as migrações.
-- gelato_app é o role de RUNTIME da API: nunca recebe UPDATE/DELETE nas tabelas
-- fiscais (concedido/revogado pela migração de imutabilidade, após as tabelas
-- existirem). Aqui só criamos o role e damos acesso de conexão/uso do schema.
CREATE ROLE gelato_app LOGIN PASSWORD 'app_pw';
GRANT CONNECT ON DATABASE gelato TO gelato_app;
GRANT USAGE ON SCHEMA public TO gelato_app;
