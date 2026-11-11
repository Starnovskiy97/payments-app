-- Отдельная роль приложения без прав суперпользователя.
-- Скрипт запускается образом PostgreSQL только при первом создании volume.
CREATE ROLE orders LOGIN PASSWORD 'orders_local';
CREATE DATABASE orders OWNER orders;
