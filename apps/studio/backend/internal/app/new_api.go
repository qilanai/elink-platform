package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (s *Service) NewAPIEnabled() bool { return os.Getenv("CANVAS_NEW_API_URL") != "" }
func newAPIBaseURL() string            { return os.Getenv("CANVAS_NEW_API_URL") }

// The gateway validates the live browser session on every request. Local
// identity records only own Studio resources; they cannot authenticate users.
func (s *Service) NewAPIUser(ctx context.Context, token string) (*model.User, error) {
	if token == "" {
		return nil, Unauthorized("请先登录账号")
	}
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			UserID   int    `json:"user_id"`
			Username string `json:"username"`
		} `json:"data"`
	}
	if err := s.newAPIRequest(ctx, token, "/api/ext/apps/studio/bootstrap", &response); err != nil {
		return nil, err
	}
	if !response.Success || response.Data.UserID <= 0 {
		return nil, Unauthorized("登录状态已失效，请重新登录")
	}
	id := "new-api-" + strconv.Itoa(response.Data.UserID)
	user, err := s.repo.User(id)
	if err == nil {
		user.Role = model.UserRoleUser
		user.DisplayName = response.Data.Username
		return user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	user = &model.User{ID: id, Username: id, DisplayName: response.Data.Username, Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := s.repo.Create(user); err != nil {
		// Concurrent first visits converge on the unique identity, never on a
		// username/email supplied by the browser or a pre-existing local user.
		return s.repo.User(id)
	}
	return user, nil
}

func (s *Service) newAPIRequest(ctx context.Context, token, path string, result any) error {
	base, err := url.Parse(strings.TrimRight(os.Getenv("CANVAS_NEW_API_URL"), "/"))
	if err != nil || base.Host == "" || (base.Scheme != "https" && base.Scheme != "http") || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return errors.New("账号服务地址配置无效")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String()+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("无法连接账号服务，请稍后重试")
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return Unauthorized("登录状态已失效，请重新登录")
	}
	if res.StatusCode != http.StatusOK {
		return errors.New("账号服务暂时不可用")
	}
	return json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(result)
}
