# 考级子系统原型

三端交互原型，用于产品评审、业务流程确认和开发沟通，不代表最终生产系统。

## 唯一工作副本

本仓库是三端原型的唯一工作副本。原始目录中的原型文件已归档，请勿再修改，避免两份内容分叉。

改动落在 `current/` 下对应目录，提交推送后 GitHub Actions 会自动重新部署。

## 在线预览

部署完成后，通过 GitHub Pages 访问：

```text
https://<用户名>.github.io/<仓库名>/
```

| 端 | 地址 |
| --- | --- |
| 后台管理端 | `/admin/` |
| 考生端小程序 | `/student/` |
| 考官端小程序 | `/judge/` |

## 本地预览

原型是静态文件，不依赖构建步骤。在仓库根目录执行：

```bash
cd current
python3 -m http.server 4180
```

然后访问：

```text
http://127.0.0.1:4180/admin/
http://127.0.0.1:4180/student/
http://127.0.0.1:4180/judge/
```

页面必须通过 HTTP 访问，直接双击 HTML 文件会因浏览器限制导致原型数据交互失效。

## 目录结构

```text
current/
├── admin/    后台管理端原型
├── student/  考生端小程序原型
├── judge/    考官端小程序原型
└── shared/   三端共用的模拟接口脚本
releases/     冻结的历史版本
changes/      版本变更记录
```

`current/` 是当前评审版本。`releases/` 用于保留已冻结的版本副本，例如 `releases/V1.0.0/`。

三端共用 `current/shared/hbyx-exam-api-client.js`，它以浏览器本地存储模拟数据交互，三端在同一站点下打开时可以联动。原型不连接真实后端，也不包含真实数据。

## 更新流程

```bash
git add .
git commit -m "update: revise exam prototype"
git push
```

推送到 `main` 后，GitHub Actions 会自动重新部署 Pages。

## 收录范围

本仓库只保留原型评审所需的前端文件。PRD 文档、客户需求说明书、功能清单、评审材料、会议记录等内部资料不在此仓库维护。
