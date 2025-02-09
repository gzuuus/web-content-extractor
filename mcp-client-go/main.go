package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/ollama/ollama/api"
)

// ConvertToOllamaTools converts MCP tools to Ollama format
func ConvertToOllamaTools(tools []mcp.Tool) []api.Tool {
	ollamaTools := make([]api.Tool, len(tools))
	for i, tool := range tools {
		ollamaTools[i] = api.Tool{
			Type: "function",
			Function: api.ToolFunction{
				Name:        tool.Name,
				Description: tool.Description,
				Parameters: struct {
					Type       string   `json:"type"`
					Required   []string `json:"required"`
					Properties map[string]struct {
						Type        string   `json:"type"`
						Description string   `json:"description"`
						Enum        []string `json:"enum,omitempty"`
					} `json:"properties"`
				}{
					Type:       tool.InputSchema.Type,
					Required:   tool.InputSchema.Required,
					Properties: convertProperties(tool.InputSchema.Properties),
				},
			},
		}
	}
	return ollamaTools
}

// Helper function to convert properties to Ollama's format
func convertProperties(props map[string]interface{}) map[string]struct {
	Type        string   `json:"type"`
	Description string   `json:"description"`
	Enum        []string `json:"enum,omitempty"`
} {
	result := make(map[string]struct {
		Type        string   `json:"type"`
		Description string   `json:"description"`
		Enum        []string `json:"enum,omitempty"`
	})

	for name, prop := range props {
		if propMap, ok := prop.(map[string]interface{}); ok {
			prop := struct {
				Type        string   `json:"type"`
				Description string   `json:"description"`
				Enum        []string `json:"enum,omitempty"`
			}{
				Type:        getString(propMap, "type"),
				Description: getString(propMap, "description"),
			}

			// Handle enum if present
			if enumRaw, ok := propMap["enum"].([]interface{}); ok {
				for _, e := range enumRaw {
					if str, ok := e.(string); ok {
						prop.Enum = append(prop.Enum, str)
					}
				}
			}

			result[name] = prop
		}
	}

	return result
}

// Helper function to safely get string values from map
func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func main() {
	ctx := context.Background()

	// Get Ollama host from env or use default
	var ollamaRawUrl string
	if ollamaRawUrl = os.Getenv("OLLAMA_HOST"); ollamaRawUrl == "" {
		ollamaRawUrl = "http://localhost:11434"
	}

	// Set up model names from env
	var toolsLLM string
	if toolsLLM = os.Getenv("TOOLS_LLM"); toolsLLM == "" {
		toolsLLM = "qwen2.5:0.5b-instruct-max"
	}

	// Create Ollama client
	url, _ := url.Parse(ollamaRawUrl)
	ollamaClient := api.NewClient(url, http.DefaultClient)

	// Create MCP client - using bun to run your TypeScript server
	mcpClient, err := client.NewStdioMCPClient(
		"bun",
		[]string{}, // Empty ENV
		"run",
		"start:mcp",
	)
	if err != nil {
		log.Fatalf("😡 Failed to create client: %v", err)
	}
	defer mcpClient.Close()

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Initialize MCP client
	fmt.Println("🚀 Initializing mcp client...")
	initRequest := mcp.InitializeRequest{}
	initRequest.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
	initRequest.Params.ClientInfo = mcp.Implementation{
		Name:    "go-mcp-client",
		Version: "1.0.0",
	}

	initResult, err := mcpClient.Initialize(ctx, initRequest)
	if err != nil {
		log.Fatalf("Failed to initialize: %v", err)
	}
	fmt.Printf("🎉 Initialized with server: %s %s\n\n",
		initResult.ServerInfo.Name,
		initResult.ServerInfo.Version,
	)

	// List Tools
	fmt.Println("🛠️ Available tools...")
	toolsRequest := mcp.ListToolsRequest{}
	tools, err := mcpClient.ListTools(ctx, toolsRequest)
	if err != nil {
		log.Fatalf("😡 Failed to list tools: %v", err)
	}

	// Display available tools
	for _, tool := range tools.Tools {
		fmt.Printf("- %s: %s\n", tool.Name, tool.Description)
		fmt.Println("Arguments:", tool.InputSchema.Properties)
	}
	fmt.Println()

	// Convert tools to Ollama format
	ollamaTools := ConvertToOllamaTools(tools.Tools)

	// Display the Ollama format
	fmt.Println("🦙 Ollama tools:")
	fmt.Println(ollamaTools)

	// Setup chat with Ollama
	messages := []api.Message{
		{
			Role:    "system",
			Content: "You are a helpful assistant that analyzes web content. After receiving the extracted content, provide a clear and concise summary focusing on the main points. Don't just repeat the raw content.",
		},
		{
			Role:    "user",
			Content: "Extract and summarize the content from this URL: 'https://www.scrapethissite.com/pages/'. What are the key features and learning resources offered?",
		},
	}

	var FALSE = false
	req := &api.ChatRequest{
		Model:    toolsLLM,
		Messages: messages,
		Options: map[string]interface{}{
			"temperature":   0.2,
			"num_predict":   2048, // Increased token limit
			"repeat_last_n": 64,   // Better context handling
		},
		Tools:  ollamaTools,
		Stream: &FALSE,
	}

	err = ollamaClient.Chat(ctx, req, func(resp api.ChatResponse) error {
		// Print initial model response if any
		if resp.Message.Content != "" {
			fmt.Printf("\n🦙 Model Response: %s\n", resp.Message.Content)
		}

		for _, toolCall := range resp.Message.ToolCalls {
			fmt.Printf("\n🛠️  Tool Call: %s\n", toolCall.Function.Name)
			fmt.Printf("Arguments: %s\n", toolCall.Function.Arguments)

			callRequest := mcp.CallToolRequest{
				Request: mcp.Request{Method: "tools/call"},
			}
			callRequest.Params.Name = toolCall.Function.Name
			callRequest.Params.Arguments = toolCall.Function.Arguments

			result, err := mcpClient.CallTool(ctx, callRequest)
			if err != nil {
				log.Printf("❌ Tool call failed: %v\n", err)
				return err
			}

			// Format the content for better readability
			var contentText string
			for _, content := range result.Content {
				if contentMap, ok := content.(map[string]interface{}); ok {
					if text, ok := contentMap["text"].(string); ok {
						contentText += text
					}
				}
			}

			// Add tool results to chat context with better formatting
			toolMessage := api.Message{
				Role:    "tool",
				Content: contentText,
			}
			req.Messages = append(req.Messages, toolMessage)

			// Add a follow-up message requesting analysis
			analysisRequest := api.Message{
				Role:    "user",
				Content: "Based on the extracted content above, please provide a concise summary of the main points and key features offered on this website.",
			}
			req.Messages = append(req.Messages, analysisRequest)
		}
		return nil
	})

	if err != nil {
		log.Fatalf("😡 Failed to chat with Ollama: %v", err)
	}
}
