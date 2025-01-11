
export class MsgGeneratorService {
    public static generateYouNotAuthMsg(){
        return "You are not authorized for perform this action";
    }

    public static generateWelcomeMsg(name: string){
        return `Hello ${name}🥳\nYou have full access👑\nYou can send me audio file and i will try transcribe audio to text🫡`;
    }
}
