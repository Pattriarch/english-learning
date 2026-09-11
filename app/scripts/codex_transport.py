"""Per-call HTTP transport using the existing OpenAI/ChatGPT authentication.

The built-in provider cannot be overridden. This named provider retains the
Responses wire format and OpenAI authentication without a custom base URL or key.
It avoids the installed CLI's repeated WebSocket retries on this connection.
No user configuration is written.
"""


def codex_http_arguments():
    settings = (
        'model_provider="openai-http"',
        'model_providers.openai-http.name="OpenAI"',
        'model_providers.openai-http.wire_api="responses"',
        'model_providers.openai-http.requires_openai_auth=true',
        'model_providers.openai-http.supports_websockets=false',
    )
    return [part for setting in settings for part in ('-c', setting)]
