import type { IconName } from './icons.tsx'

export type TrainingAreaId = 'daily' | 'scenes' | 'ai'

export interface TrainingAreaDefinition {
  readonly id: TrainingAreaId
  readonly title: string
  readonly description: string
  readonly eyebrow: string
  readonly icon: IconName
  readonly accent: 'indigo' | 'coral' | 'mint'
  readonly statusLabel: string
  readonly actionLabel: string
}

export interface TravelSceneDefinition {
  readonly id: string
  readonly title: string
  readonly description: string
}

export interface TravelSceneCategoryDefinition {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly icon: IconName
  readonly accent: TrainingAreaDefinition['accent']
  readonly scenes: readonly TravelSceneDefinition[]
}

export const trainingAreas: readonly TrainingAreaDefinition[] = [
  {
    id: 'daily',
    title: '日常训练',
    description: '水平测试、词汇、听力和口语都在这里。',
    eyebrow: 'DAILY PRACTICE',
    icon: 'target',
    accent: 'indigo',
    statusLabel: '正常使用',
    actionLabel: '进入日常训练',
  },
  {
    id: 'scenes',
    title: '场景训练',
    description: '按旅行环节进入6类、18个真实使用场景。',
    eyebrow: 'TRAVEL SCENES',
    icon: 'book',
    accent: 'mint',
    statusLabel: '框架已建立',
    actionLabel: '查看旅行场景',
  },
  {
    id: 'ai',
    title: 'AI 对话训练',
    description: '未来用于开放式旅行英语对话练习。',
    eyebrow: 'AI CONVERSATION',
    icon: 'spark',
    accent: 'coral',
    statusLabel: '暂未开放',
    actionLabel: '查看说明',
  },
]

export const travelSceneCategories:
readonly TravelSceneCategoryDefinition[] = [
  {
    id: 'airport-flight',
    title: '机场与飞行',
    description: '从进入机场到完成入境和离开机场。',
    icon: 'headphones',
    accent: 'indigo',
    scenes: [
      { id: 'airport', title: '机场', description: '值机、安检和寻找登机口。' },
      { id: 'on-plane', title: '飞机上', description: '座位、餐饮和机上服务。' },
      { id: 'immigration', title: '入境海关', description: '回答入境目的和行程问题。' },
      { id: 'baggage-claim', title: '行李提取', description: '寻找转盘和处理行李问题。' },
      { id: 'customs-inspection', title: '海关行李检查', description: '申报物品和配合行李检查。' },
      { id: 'currency-exchange', title: '货币兑换', description: '询问汇率、手续费和兑换金额。' },
      { id: 'airport-transport', title: '机场交通', description: '寻找进入市区的交通方式。' },
    ],
  },
  {
    id: 'city-transport',
    title: '城市交通',
    description: '在目的地乘车、换乘或租车。',
    icon: 'arrow-right',
    accent: 'mint',
    scenes: [
      { id: 'taxi', title: '出租车', description: '说明目的地、路线和付款方式。' },
      { id: 'public-transport', title: '公共交通', description: '买票、问站和确认换乘。' },
      { id: 'car-rental', title: '自驾租车', description: '车型、保险、取车和还车。' },
    ],
  },
  {
    id: 'stay-dining',
    title: '住宿与餐饮',
    description: '办理住宿并完成常见餐厅沟通。',
    icon: 'home',
    accent: 'coral',
    scenes: [
      { id: 'hotel', title: '酒店', description: '入住、设施、客房和退房。' },
      { id: 'restaurant', title: '餐厅', description: '订位、点餐、需求和结账。' },
    ],
  },
  {
    id: 'shopping-sightseeing',
    title: '购物与观光',
    description: '购物交流和景点游览。',
    icon: 'target',
    accent: 'indigo',
    scenes: [
      { id: 'shopping', title: '购物', description: '价格、尺码、试用、退换和付款。' },
      { id: 'sightseeing', title: '景点观光', description: '门票、开放时间和参观信息。' },
    ],
  },
  {
    id: 'help-connectivity',
    title: '日常求助与通信',
    description: '解决旅行中的日常小问题。',
    icon: 'info',
    accent: 'mint',
    scenes: [
      { id: 'asking-for-help', title: '向路人求助', description: '问路、确认位置和请求协助。' },
      { id: 'restroom', title: '卫生间', description: '寻找卫生间并询问使用条件。' },
      { id: 'connectivity', title: '网络与通信', description: '购买电话卡和询问公共 Wi-Fi。' },
    ],
  },
  {
    id: 'health',
    title: '医疗与药店',
    description: '身体不适、就医和购买常用药。',
    icon: 'mic',
    accent: 'coral',
    scenes: [
      { id: 'medical-pharmacy', title: '医疗与药店', description: '描述症状、寻求医疗帮助和购买药品。' },
    ],
  },
]

export const travelScenes: readonly TravelSceneDefinition[] =
  travelSceneCategories.flatMap((category) => category.scenes)

export function getTravelSceneCategory(categoryId: string) {
  return travelSceneCategories.find(
    (category) => category.id === categoryId,
  )
}

export function getTravelScene(sceneId: string) {
  for (const category of travelSceneCategories) {
    const scene = category.scenes.find(
      (candidate) => candidate.id === sceneId,
    )
    if (scene) {
      return { category, scene }
    }
  }
  return undefined
}
