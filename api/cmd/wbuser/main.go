// Command wbuser 管理工作台的組員帳號（不開放註冊）。
//
// 用法（在 api/ 下執行，需設定 DATABASE_URL）：
//
//	go run ./cmd/wbuser add <帳號> <顯示名稱>   建立帳號
//	go run ./cmd/wbuser passwd <帳號>           重設密碼（該帳號所有登入都會失效）
//
// 密碼由終端機輸入（不顯示）；非互動環境（腳本、CI）以環境變數 WBUSER_PASSWORD 提供。
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/term"

	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/pgstore"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "錯誤：", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) < 2 {
		return errors.New("用法：wbuser add <帳號> <顯示名稱>｜wbuser passwd <帳號>")
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("請設定 DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgstore.Open(ctx, url)
	if err != nil {
		return err
	}
	defer db.Close()
	svc := auth.NewService(db)

	switch cmd, username := args[0], args[1]; cmd {
	case "add":
		if len(args) < 3 {
			return errors.New("用法：wbuser add <帳號> <顯示名稱>")
		}
		password, err := readPassword()
		if err != nil {
			return err
		}
		u, err := svc.CreateUser(ctx, username, strings.Join(args[2:], " "), password)
		if err != nil {
			return err
		}
		fmt.Printf("已建立帳號 %s（%s）\n", u.Username, u.DisplayName)
	case "passwd":
		password, err := readPassword()
		if err != nil {
			return err
		}
		if err := svc.SetPassword(ctx, username, password); err != nil {
			return err
		}
		fmt.Printf("已重設 %s 的密碼\n", username)
	default:
		return fmt.Errorf("未知的指令 %q（add、passwd）", cmd)
	}
	return nil
}

func readPassword() (string, error) {
	if p := os.Getenv("WBUSER_PASSWORD"); p != "" {
		return p, nil
	}
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		return strings.TrimRight(line, "\r\n"), err
	}
	fmt.Fprintf(os.Stderr, "密碼（至少 %d 個字元）：", auth.MinPasswordLen)
	first, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	fmt.Fprint(os.Stderr, "再輸入一次：")
	second, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if string(first) != string(second) {
		return "", errors.New("兩次輸入的密碼不同")
	}
	return string(first), nil
}
