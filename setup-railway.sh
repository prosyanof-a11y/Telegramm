#!/bin/bash  
echo "Установка переменных окружения в Railway..."  
railway variables set DATABASE_URL="$1"  
railway variables set TELEGRAM_BOT_TOKEN="$2"  
railway variables set TELEGRAM_ADMIN_CHAT_ID="$3"  
railway variables set ANTHROPIC_API_KEY="$4"  
railway variables set FAL_API_KEY="$5"  
railway variables set FIGMA_ACCESS_TOKEN="$6"  
railway variables set NODE_ENV="production"  
echo "Готово! Запускаю деплой..."  
railway up 
