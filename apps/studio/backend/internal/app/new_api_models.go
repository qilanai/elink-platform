package app

import (
	"context"
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
)

// An Agent may delegate only the bounded authorization captured by its own
// root task. Secrets remain encrypted at rest and every use is revalidated by
// new-api; a restarted worker cannot invent or extend a browser session.
func (s *Service) newAPITaskAuthorization(userID, taskID string) (string, error) {
	if !s.NewAPIEnabled() {
		return "", nil
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return "", err
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return "", err
	}
	if err := s.decryptTaskSecrets(input); err != nil {
		return "", err
	}
	config, _ := input["config"].(map[string]any)
	token, _ := config["apiKey"].(string)
	user, err := s.NewAPIUser(context.Background(), token)
	if err != nil {
		return "", err
	}
	if user.ID != userID {
		return "", Unauthorized("任务授权与当前账号不匹配")
	}
	return token, nil
}

func (s *Service) newAPIAgentCatalog(execution []string) (*ModelCatalogResponse, error) {
	if len(execution) != 2 {
		return nil, Unauthorized("缺少任务授权")
	}
	token, err := s.newAPITaskAuthorization(execution[0], execution[1])
	if err != nil {
		return nil, err
	}
	return s.NewAPIModelCatalog(context.Background(), token)
}

func newAPISelectionSignature(task *model.Task) string {
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	config, _ := input["config"].(map[string]any)
	delete(config, "apiKey")
	return "new-api:" + creationHash([]any{task.Model, input["mode"], config})
}

type newAPIModel struct {
	ID            string   `json:"id"`
	Description   string   `json:"description"`
	Endpoints     []string `json:"endpoints"`
	EndpointPaths []string `json:"endpoint_paths"`
}

func (s *Service) NewAPIModelCatalog(ctx context.Context, token string) (*ModelCatalogResponse, error) {
	items, err := s.newAPIModels(ctx, token)
	if err != nil {
		return nil, err
	}
	return newAPIModelCatalog(items), nil
}

func (s *Service) newAPIModels(ctx context.Context, token string) ([]newAPIModel, error) {
	var response struct {
		Success bool          `json:"success"`
		Data    []newAPIModel `json:"data"`
	}
	if err := s.newAPIRequest(ctx, token, "/api/ext/apps/studio/catalog", &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, ModelCatalogMismatch("模型目录暂时不可用")
	}
	return response.Data, nil
}

func newAPIModelCatalog(items []newAPIModel) *ModelCatalogResponse {
	channels := []PublicChannelCatalog{}
	for _, capability := range []string{"text", "image", "video", "audio"} {
		channels = append(channels, PublicChannelCatalog{ID: "new-api-" + capability, Name: "模型广场", DisplayName: "模型广场", Models: []PublicChannelModel{}})
	}
	for _, item := range items {
		for _, endpoint := range append(item.EndpointPaths, item.Endpoints...) {
			var capability string
			var protocol model.ChannelInterfaceType
			switch endpoint {
			case "openai", "anthropic", "gemini", "/v1/chat/completions":
				capability, protocol = "text", model.ChannelInterfaceChatCompletion
			case "openai-response", "/v1/responses":
				capability, protocol = "text", model.ChannelInterfaceOpenAIResponse
			case "image-generation", "/v1/images/generations", "/v1/images/edits":
				capability, protocol = "image", model.ChannelInterfaceOpenAIImage
			case "openai-video", "/v1/videos":
				capability, protocol = "video", model.ChannelInterfaceNewAPIVideo
			case "audio-speech", "openai-audio", "/v1/audio/speech":
				capability, protocol = "audio", model.ChannelInterfaceOpenAIAudio
			default:
				continue
			}
			var channel *PublicChannelCatalog
			for index := range channels {
				if channels[index].ID == "new-api-"+capability {
					channel = &channels[index]
					break
				}
			}
			// A model may expose several endpoints. Keep one entry per model
			// and capability; protocol metadata, never its name, drives selection.
			duplicate := false
			for _, existing := range channel.Models {
				if existing.ModelKey == item.ID && existing.Capability == capability {
					duplicate = true
					break
				}
			}
			if duplicate {
				continue
			}
			channel.Models = append(channel.Models, PublicChannelModel{
				ID: capability + ":" + item.ID, ModelKey: item.ID, DisplayName: item.ID,
				Description: item.Description, Capability: capability, Protocol: protocol,
				PriceTiers: []PublicChannelModelPriceTier{}, Available: true,
			})
		}
	}
	return &ModelCatalogResponse{Source: ModelCatalogSourceSystem, Models: []PublicLogicalModel{}, Channels: channels}
}

func (s *Service) newAPITranscriptionConfig(ctx context.Context, userID, token, modelName string) (map[string]any, error) {
	user, err := s.NewAPIUser(ctx, token)
	if err != nil {
		return nil, err
	}
	if user.ID != userID {
		return nil, Unauthorized("当前账号已切换，请刷新页面")
	}
	items, err := s.newAPIModels(ctx, token)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if modelName != "" && item.ID != modelName {
			continue
		}
		for _, path := range append(item.EndpointPaths, item.Endpoints...) {
			if path == "/v1/audio/transcriptions" || path == "audio-transcription" {
				return map[string]any{"model": item.ID, "apiKey": token}, nil
			}
		}
	}
	return nil, InvalidModelSelection("模型广场尚未为当前账号配置语音转写端点")
}

func (s *Service) resolveNewAPISelection(ctx context.Context, userID, token string, input map[string]any) (map[string]any, error) {
	user, err := s.NewAPIUser(ctx, token)
	if err != nil {
		return nil, err
	}
	if user.ID != userID {
		return nil, Unauthorized("当前账号已切换，请刷新页面")
	}
	catalog, err := s.NewAPIModelCatalog(ctx, token)
	if err != nil {
		return nil, err
	}
	config, _ := input["config"].(map[string]any)
	name, _ := config["model"].(string)
	mode, _ := input["mode"].(string)
	for _, channel := range catalog.Channels {
		for _, item := range channel.Models {
			if item.ModelKey != name || item.Capability != mode {
				continue
			}
			// Retain generation options, replace all routing/credential fields.
			for _, key := range []string{"channelId", "channelModelId", "channelModelKey", "providerModelKey", "priceTierId", "headers", "secretKey", "capabilityConfig", "endpointOverrides"} {
				delete(config, key)
			}
			config["baseUrl"] = strings.TrimRight(newAPIBaseURL(), "/") + "/api/ext/apps/studio/relay/v1"
			config["apiKey"] = token
			config["apiFormat"] = "openai"
			config["interfaceType"] = string(item.Protocol)
			return input, nil
		}
	}
	return nil, InvalidModelSelection("该模型不在当前账号的可用模型范围内")
}
