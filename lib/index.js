// dsh-native-model-picker — host side
//
// 功能全部在渲染端（见 ./client.js）：接管 DSH 模型选择入口，
// 以自建三级卡片呈现收藏/渠道/模型视图，数据与切换都走宿主 modelDirectories 服务。
// 宿主侧只负责声明插件，无服务、无路由、无持久化。

export const name = "dsh-native-model-picker";
export const inject = [];

export function apply(ctx) {
  ctx.logger.info("dsh-native-model-picker: started (host-directory three-level model picker)");
}
