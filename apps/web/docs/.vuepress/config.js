import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress/cli'
import { viteBundler } from '@vuepress/bundler-vite'

export default defineUserConfig({
  lang: 'en-US',
  base: '/node-network-devtools/',

  title: 'VuePress',
  description: 'My first VuePress Site',

  theme: defaultTheme({
    logo: 'logo.png',
    contributors: true,
    navbar: ['/', '/get-started'],
    locales: {
      '/': {
        selectLanguageName: 'English',
        navbar: ['/', '/get-started']
      },
      '/zh/': {
        selectLanguageName: '简体中文',
        navbar: ['/zh/', '/zh/get-started']
      }
    }
  }),

  bundler: viteBundler(),
  locales: {
    '/': {
      lang: 'en-US',
      title: 'Node Network Devtools',
      description: "In Chrome devtools debugger NodeJs's Request"
    },
    '/zh/': {
      lang: '简体中文',
      title: 'Node Network Devtools',
      description: '在 Chrome devtools 调试 NodeJs 的网络请求'
    }
  }
})
