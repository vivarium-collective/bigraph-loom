backend ?= default

.PHONY: dev

dev:
ifeq ($(backend),sms)
	@echo "Starting frontend only (SMS-API client mode)..."
	@cd frontend && VITE_SMS_API_BASE_URL="https://sms.cam.uchc.edu" npm run dev
else
	@echo "Starting backend (uvicorn :8891) and frontend (vite :3000)..."
	@trap 'kill 0' EXIT; \
		uvicorn bigraph_loom.api:app --reload --port 8891 & \
		cd frontend && npm run dev & \
		wait
endif
