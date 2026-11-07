// Built-in decks. Each entry is an English Wikipedia page title.
// Photos + short descriptions are fetched live from Wikipedia at game start.
window.DECKS = {
  bollywood: {
    label: "Bollywood & Indian Cinema",
    emoji: "🎬",
    people: [
      "Shah Rukh Khan", "Amitabh Bachchan", "Salman Khan", "Aamir Khan", "Deepika Padukone",
      "Priyanka Chopra", "Alia Bhatt", "Ranbir Kapoor", "Ranveer Singh", "Katrina Kaif",
      "Hrithik Roshan", "Akshay Kumar", "Kareena Kapoor", "Aishwarya Rai Bachchan", "Madhuri Dixit",
      "Shahid Kapoor", "Varun Dhawan", "Vicky Kaushal", "Sonam Kapoor", "Anushka Sharma",
      "Ajay Devgn", "Kajol", "Rajinikanth", "Prabhas", "Allu Arjun",
      "Nawazuddin Siddiqui", "Pankaj Tripathi", "Ayushmann Khurrana", "Rajkummar Rao", "Taapsee Pannu",
      "Sridevi", "Rekha", "Dharmendra", "Kartik Aaryan", "Shraddha Kapoor",
      "Tiger Shroff", "Sanjay Dutt", "Kamal Haasan", "Vijay (actor)", "Samantha Ruth Prabhu"
    ]
  },
  cricket: {
    label: "Cricket Legends",
    emoji: "🏏",
    people: [
      "Sachin Tendulkar", "Virat Kohli", "MS Dhoni", "Rohit Sharma", "Jasprit Bumrah",
      "Hardik Pandya", "Ravindra Jadeja", "Rahul Dravid", "Sourav Ganguly", "Kapil Dev",
      "Yuvraj Singh", "Virender Sehwag", "Anil Kumble", "Shubman Gill", "Rishabh Pant",
      "KL Rahul", "Suryakumar Yadav", "Smriti Mandhana", "Mithali Raj", "Harbhajan Singh",
      "Zaheer Khan", "Ricky Ponting", "Shane Warne", "Brian Lara", "AB de Villiers",
      "Chris Gayle", "Ben Stokes", "Joe Root", "Babar Azam", "Pat Cummins",
      "Steve Smith (cricketer)", "Kane Williamson", "Muttiah Muralitharan", "Wasim Akram", "Glenn Maxwell"
    ]
  },
  hollywood: {
    label: "Hollywood",
    emoji: "🍿",
    people: [
      "Leonardo DiCaprio", "Tom Cruise", "Brad Pitt", "Angelina Jolie", "Scarlett Johansson",
      "Robert Downey Jr.", "Chris Hemsworth", "Dwayne Johnson", "Will Smith", "Keanu Reeves",
      "Margot Robbie", "Zendaya", "Tom Holland", "Meryl Streep", "Morgan Freeman",
      "Johnny Depp", "Jennifer Lawrence", "Emma Watson", "Ryan Reynolds", "Ryan Gosling",
      "Denzel Washington", "Cillian Murphy", "Timothée Chalamet", "Natalie Portman", "Anne Hathaway",
      "Samuel L. Jackson", "Tom Hanks", "Nicole Kidman", "Keira Knightley", "Hugh Jackman",
      "Pedro Pascal", "Florence Pugh", "Jackie Chan", "Sandra Bullock", "Matt Damon"
    ]
  },
  music: {
    label: "Music Stars",
    emoji: "🎤",
    people: [
      "Taylor Swift", "Beyoncé", "Ed Sheeran", "Rihanna", "Drake (musician)",
      "Justin Bieber", "Billie Eilish", "Ariana Grande", "Bruno Mars", "Lady Gaga",
      "The Weeknd", "Dua Lipa", "Shakira", "Eminem", "Michael Jackson",
      "Freddie Mercury", "Elvis Presley", "Madonna", "Adele", "Harry Styles",
      "Bad Bunny", "Arijit Singh", "A. R. Rahman", "Lata Mangeshkar", "Shreya Ghoshal",
      "Diljit Dosanjh", "Badshah (rapper)", "Yo Yo Honey Singh", "Kishore Kumar", "Jungkook",
      "Lisa (rapper)", "Snoop Dogg", "Kanye West", "Post Malone", "Olivia Rodrigo"
    ]
  },
  sports: {
    label: "Sports Icons",
    emoji: "⚽",
    people: [
      "Lionel Messi", "Cristiano Ronaldo", "Neymar", "Kylian Mbappé", "Erling Haaland",
      "Roger Federer", "Rafael Nadal", "Novak Djokovic", "Serena Williams", "Usain Bolt",
      "Michael Jordan", "LeBron James", "Stephen Curry", "Lewis Hamilton", "Max Verstappen",
      "Tiger Woods", "Muhammad Ali", "Mike Tyson", "Conor McGregor", "Neeraj Chopra",
      "P. V. Sindhu", "Sunil Chhetri", "Mary Kom", "Simone Biles", "Michael Phelps",
      "David Beckham", "Zinedine Zidane", "Diego Maradona", "Pelé", "Abhinav Bindra",
      "Saina Nehwal", "Mohamed Salah"
    ]
  },
  tech: {
    label: "Tech & Business",
    emoji: "💼",
    people: [
      "Elon Musk", "Mark Zuckerberg", "Bill Gates", "Steve Jobs", "Jeff Bezos",
      "Sundar Pichai", "Satya Nadella", "Tim Cook", "Sam Altman", "Jensen Huang",
      "Warren Buffett", "Ratan Tata", "Mukesh Ambani", "Gautam Adani", "N. R. Narayana Murthy",
      "Larry Page", "Sergey Brin", "Jack Ma", "Oprah Winfrey", "Richard Branson",
      "Steve Wozniak", "Bernard Arnault", "Larry Ellison", "Sheryl Sandberg", "Anand Mahindra",
      "Nandan Nilekani", "Kiran Mazumdar-Shaw", "Indra Nooyi"
    ]
  },
  history: {
    label: "Leaders & Legends",
    emoji: "🏛️",
    people: [
      "Narendra Modi", "Mahatma Gandhi", "Jawaharlal Nehru", "B. R. Ambedkar", "Indira Gandhi",
      "A. P. J. Abdul Kalam", "Barack Obama", "Donald Trump", "Joe Biden", "Vladimir Putin",
      "Xi Jinping", "Elizabeth II", "Charles III", "Winston Churchill", "Abraham Lincoln",
      "Nelson Mandela", "Martin Luther King Jr.", "Albert Einstein", "Mother Teresa", "14th Dalai Lama",
      "Pope Francis", "Angela Merkel", "Emmanuel Macron", "Justin Trudeau", "Rishi Sunak",
      "Kamala Harris", "Volodymyr Zelenskyy", "Bhagat Singh", "Subhas Chandra Bose", "Swami Vivekananda",
      "Marie Curie", "Isaac Newton", "Stephen Hawking", "Nikola Tesla", "Frida Kahlo"
    ]
  }
};
