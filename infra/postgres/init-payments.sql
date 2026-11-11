-- Платежи используют свою БД и обычную роль, без доступа к серверу заказов.
CREATE ROLE payments LOGIN PASSWORD 'payments_local';
CREATE DATABASE payments OWNER payments;
