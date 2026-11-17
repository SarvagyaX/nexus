"""Provider-agnostic LLM client supporting local Ollama, OpenAI-compatible APIs, and deterministic mock."""

import json
from typing import Any
import httpx
from pydantic import BaseModel

from app.core.config import get_settings


class LLMProviderStatus(BaseModel):
    provider: str
    model: str
    is_available: bool
    message: str | None = None


class BaseLLMClient:
    async def check_health(self) -> LLMProviderStatus:
        raise NotImplementedError

    async def generate_json(self, prompt: str, system: str | None = None) -> dict[str, Any]:
        raise NotImplementedError


class OllamaClient(BaseLLMClient):
    """Local Ollama client using Ollama's HTTP API."""

    def __init__(self, base_url: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def check_health(self) -> LLMProviderStatus:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{self.base_url}/api/version")
                if res.status_code == 200:
                    version_data = res.json()
                    version = version_data.get("version", "unknown")
                    return LLMProviderStatus(
                        provider="ollama",
                        model=self.model,
                        is_available=True,
                        message=f"Connected to Ollama v{version}",
                    )
                return LLMProviderStatus(
                    provider="ollama",
                    model=self.model,
                    is_available=False,
                    message=f"Ollama returned HTTP {res.status_code}",
                )
        except Exception as exc:
            return LLMProviderStatus(
                provider="ollama",
                model=self.model,
                is_available=False,
                message=f"Ollama is unreachable at {self.base_url}: {str(exc)}",
            )

    async def generate_json(self, prompt: str, system: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "format": "json",
            "stream": False,
        }
        if system:
            payload["system"] = system

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                res = await client.post(f"{self.base_url}/api/generate", json=payload)
            except Exception as exc:
                raise RuntimeError(f"Ollama request failed: {str(exc)}") from exc

            if res.status_code != 200:
                raise RuntimeError(f"Ollama returned HTTP {res.status_code}: {res.text}")

            body = res.json()
            response_text = body.get("response", "{}")
            try:
                return json.loads(response_text)
            except json.JSONDecodeError as err:
                raise RuntimeError(f"Failed to parse Ollama JSON response: {response_text}") from err


class OpenAICompatibleClient(BaseLLMClient):
    """Client for OpenAI-compatible APIs (OpenAI, vLLM, LiteLLM, Groq, DeepSeek)."""

    def __init__(self, api_key: str | None, model: str, base_url: str = "https://api.openai.com/v1"):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    async def check_health(self) -> LLMProviderStatus:
        if not self.api_key:
            return LLMProviderStatus(
                provider="openai",
                model=self.model,
                is_available=False,
                message="LLM_API_KEY is not configured.",
            )
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                if res.status_code in {200, 401, 403}:
                    is_ok = res.status_code == 200
                    return LLMProviderStatus(
                        provider="openai",
                        model=self.model,
                        is_available=is_ok,
                        message="Connected" if is_ok else "Invalid API key or unauthorized",
                    )
                return LLMProviderStatus(
                    provider="openai",
                    model=self.model,
                    is_available=False,
                    message=f"Endpoint returned HTTP {res.status_code}",
                )
        except Exception as exc:
            return LLMProviderStatus(
                provider="openai",
                model=self.model,
                is_available=False,
                message=f"Endpoint unreachable: {str(exc)}",
            )

    async def generate_json(self, prompt: str, system: str | None = None) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("LLM_API_KEY must be provided for OpenAI provider.")

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                res = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            except Exception as exc:
                raise RuntimeError(f"OpenAI request failed: {str(exc)}") from exc

            if res.status_code != 200:
                raise RuntimeError(f"OpenAI returned HTTP {res.status_code}: {res.text}")

            content = res.json()["choices"][0]["message"]["content"]
            return json.loads(content)


class MockLLMClient(BaseLLMClient):
    """Deterministic, provider-free analytical engine used when LLM_PROVIDER=mock."""

    def __init__(self, model: str = "mock-analytical-v1"):
        self.model = model

    async def check_health(self) -> LLMProviderStatus:
        return LLMProviderStatus(
            provider="mock",
            model=self.model,
            is_available=True,
            message="Deterministic mock provider active (offline development mode)",
        )

    async def generate_json(self, prompt: str, system: str | None = None) -> dict[str, Any]:
        # Return empty dict; mock analytical reasoning in workflow handles structure directly
        return {}


def get_llm_client() -> BaseLLMClient:
    settings = get_settings()
    provider = (settings.llm_provider or "mock").strip().lower()

    if provider == "ollama":
        return OllamaClient(
            base_url=settings.ollama_base_url,
            model=settings.llm_model,
        )
    elif provider in {"openai", "openai_compatible"}:
        api_key = settings.llm_api_key.get_secret_value() if settings.llm_api_key else None
        return OpenAICompatibleClient(
            api_key=api_key,
            model=settings.llm_model,
        )
    else:
        return MockLLMClient(model="mock-analytical-v1")
